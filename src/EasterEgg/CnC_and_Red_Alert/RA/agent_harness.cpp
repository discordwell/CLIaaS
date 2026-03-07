/*
** Agent harness for WASM builds.
** Provides exported C functions callable from JavaScript to enable
** AI-driven gameplay via pause-step JSON API.
**
** Three exports:
**   agent_get_state()  — returns JSON string of current game state
**   agent_command()    — processes JSON command array, returns results
**   agent_step()       — commands + N ticks + fresh state (combined)
**
** ID encoding: (RTTI << 16) | heap_index
** IDs are only valid for the current tick — heap compaction after deaths
** can shift indices. Always re-read state after stepping.
*/

#include "function.h"
#include <stdio.h>
#include <string.h>
#include <stdarg.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

extern int g_autoplay_mode;
extern bool Main_Loop();
extern TARGET As_Target(CELL cell);

/* --- ID encoding: (rtti << 16) | heap_index --- */
#define AGENT_ID(rtti, idx) (((int)(rtti) << 16) | (idx))
#define AGENT_RTTI(id)      ((RTTIType)((id) >> 16))
#define AGENT_IDX(id)       ((id) & 0xFFFF)

/* --- Static output buffers --- */
#define STATE_BUF_SIZE 65536
#define CMD_BUF_SIZE   4096
#define STEP_BUF_SIZE  65536

static char s_state_buf[STATE_BUF_SIZE];
static char s_cmd_buf[CMD_BUF_SIZE];
static char s_step_buf[STEP_BUF_SIZE];

/* --- Buffer write helpers (global cursor) --- */
static int   s_pos;
static char* s_buf;
static int   s_buf_size;

static void buf_init(char* buf, int size)
{
	s_buf = buf;
	s_buf_size = size;
	s_pos = 0;
	buf[0] = '\0';
}

static void buf_cat(const char* fmt, ...)
{
	if (s_pos >= s_buf_size - 1) return;
	va_list args;
	va_start(args, fmt);
	int written = vsnprintf(s_buf + s_pos, s_buf_size - s_pos, fmt, args);
	va_end(args);
	if (written > 0) {
		if (written < s_buf_size - s_pos) {
			s_pos += written;
		} else {
			/* Truncated — advance to end so further writes are no-ops */
			s_pos = s_buf_size - 1;
		}
	}
}

/* --- Object lookup from AGENT_ID --- */
static TechnoClass* agent_lookup(int id)
{
	RTTIType rtti = AGENT_RTTI(id);
	int idx = AGENT_IDX(id);
	switch (rtti) {
		case RTTI_UNIT:     return (idx < Units.Count())     ? (TechnoClass*)Units.Ptr(idx)     : NULL;
		case RTTI_INFANTRY: return (idx < Infantry.Count())  ? (TechnoClass*)Infantry.Ptr(idx)  : NULL;
		case RTTI_AIRCRAFT: return (idx < Aircraft.Count())  ? (TechnoClass*)Aircraft.Ptr(idx)  : NULL;
		case RTTI_VESSEL:   return (idx < Vessels.Count())   ? (TechnoClass*)Vessels.Ptr(idx)   : NULL;
		case RTTI_BUILDING: return (idx < Buildings.Count()) ? (TechnoClass*)Buildings.Ptr(idx) : NULL;
		default: return NULL;
	}
}

/* --- Serialize one object as JSON into the active buffer --- */
static void serialize_obj(ObjectClass* obj, RTTIType rtti, int idx, bool ally, bool is_first)
{
	if (!is_first) buf_cat(",");

	COORDINATE coord = obj->Center_Coord();
	CELL cell = Coord_Cell(coord);

	buf_cat("{\"id\":%d,\"t\":\"%s\",\"cx\":%d,\"cy\":%d,\"hp\":%d,\"mhp\":%d,\"m\":%d,\"ally\":%s}",
		AGENT_ID(rtti, idx),
		obj->Class_Of().Name(),
		Cell_X(cell), Cell_Y(cell),
		(int)obj->Strength,
		(int)obj->Class_Of().MaxStrength,
		(int)obj->Get_Mission(),
			ally ? "true" : "false");
}

static int agent_power_produced(void)
{
	int total = 0;

	if (!PlayerPtr) return 0;

	for (int i = 0; i < Buildings.Count(); i++) {
		BuildingClass* b = Buildings.Ptr(i);
		if (!b || b->IsInLimbo || b->Strength <= 0) continue;
		if (!PlayerPtr->Is_Ally(b)) continue;
		total += b->Power_Output();
	}

	return total;
}

static int agent_power_consumed(void)
{
	int total = 0;

	if (!PlayerPtr) return 0;

	for (int i = 0; i < Buildings.Count(); i++) {
		BuildingClass* b = Buildings.Ptr(i);
		if (!b || b->IsInLimbo || b->Strength <= 0) continue;
		if (!PlayerPtr->Is_Ally(b)) continue;
		total += b->Class->Drain;
	}

	return total;
}

/* ======================================================================
 * JSON mini-parser — only handles the subset needed for agent commands:
 *   [{"cmd":"move","ids":[123,456],"cx":50,"cy":60,"target":789}, ...]
 * ====================================================================== */

struct AgentCmd {
	char cmd[16];
	int  ids[32];
	int  id_count;
	int  cx, cy;
	int  target;
	bool has_cx, has_cy, has_target;
};

static const char* skip_ws(const char* p)
{
	while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
	return p;
}

static const char* jp_string(const char* p, char* out, int maxlen)
{
	p = skip_ws(p);
	if (*p != '"') return NULL;
	p++;
	int i = 0;
	while (*p && *p != '"' && i < maxlen - 1) {
		out[i++] = *p++;
	}
	out[i] = '\0';
	if (*p == '"') p++;
	return p;
}

static const char* jp_int(const char* p, int* out)
{
	p = skip_ws(p);
	int sign = 1;
	if (*p == '-') { sign = -1; p++; }
	int val = 0;
	while (*p >= '0' && *p <= '9') {
		val = val * 10 + (*p - '0');
		p++;
	}
	*out = val * sign;
	return p;
}

static const char* jp_int_array(const char* p, int* out, int maxcount, int* count)
{
	p = skip_ws(p);
	*count = 0;
	if (*p != '[') return p;
	p++;
	while (1) {
		p = skip_ws(p);
		if (*p == ']') { p++; break; }
		if (*count >= maxcount) break;
		p = jp_int(p, &out[(*count)++]);
		p = skip_ws(p);
		if (*p == ',') p++;
	}
	return p;
}

static const char* jp_skip_value(const char* p)
{
	p = skip_ws(p);
	if (*p == '"') {
		p++;
		while (*p && *p != '"') {
			if (*p == '\\' && *(p+1)) p++;
			p++;
		}
		if (*p == '"') p++;
	} else if (*p == '[' || *p == '{') {
		char open = *p, close = (*p == '[') ? ']' : '}';
		int depth = 1;
		p++;
		while (*p && depth > 0) {
			if (*p == open) depth++;
			else if (*p == close) depth--;
			else if (*p == '"') {
				p++;
				while (*p && *p != '"') {
					if (*p == '\\' && *(p+1)) p++;
					p++;
				}
			}
			p++;
		}
	} else {
		while (*p && *p != ',' && *p != '}' && *p != ']') p++;
	}
	return p;
}

static int parse_commands(const char* json, AgentCmd* cmds, int maxcmds)
{
	if (!json || !*json) return 0;
	const char* p = skip_ws(json);
	if (*p != '[') return 0;
	p++;

	int count = 0;
	while (count < maxcmds) {
		p = skip_ws(p);
		if (*p == ']' || *p == '\0') break;
		if (*p == ',') { p++; p = skip_ws(p); }
		if (*p != '{') break;
		p++;

		AgentCmd& c = cmds[count];
		memset(&c, 0, sizeof(AgentCmd));

		while (*p && *p != '}') {
			p = skip_ws(p);
			if (*p == ',') { p++; p = skip_ws(p); }
			if (*p == '}') break;

			char key[16] = {0};
			p = jp_string(p, key, sizeof(key));
			if (!p) break;

			p = skip_ws(p);
			if (*p == ':') p++;
			p = skip_ws(p);

			if (strcmp(key, "cmd") == 0) {
				p = jp_string(p, c.cmd, sizeof(c.cmd));
				if (!p) break;
			} else if (strcmp(key, "ids") == 0) {
				p = jp_int_array(p, c.ids, 32, &c.id_count);
			} else if (strcmp(key, "cx") == 0) {
				p = jp_int(p, &c.cx);
				c.has_cx = true;
			} else if (strcmp(key, "cy") == 0) {
				p = jp_int(p, &c.cy);
				c.has_cy = true;
			} else if (strcmp(key, "target") == 0) {
				p = jp_int(p, &c.target);
				c.has_target = true;
			} else {
				p = jp_skip_value(p);
			}
		}
		if (*p == '}') p++;
		count++;
	}

	return count;
}

/* ======================================================================
 * Run one game tick (same logic as autoplay_tick in input_inject.cpp)
 * ====================================================================== */
static int do_tick(void)
{
	TimeQuake = false;
	bool done = Main_Loop();
	return done ? 1 : 0;
}

/* ======================================================================
 * EXPORT 1: agent_get_state — serialize current game state as JSON
 * ====================================================================== */
extern "C" {

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* agent_get_state(void)
{
	buf_init(s_state_buf, STATE_BUF_SIZE);

	if (!PlayerPtr) {
		buf_cat("{\"error\":\"no player\"}");
		return s_state_buf;
	}

	HousesType player_house = PlayerPtr->Class->House;
	int power_produced = agent_power_produced();
	int power_consumed = agent_power_consumed();

	buf_cat("{\"tick\":%ld,\"credits\":%ld,\"power\":{\"produced\":%d,\"consumed\":%d},",
		Frame,
		(long)(PlayerPtr->Credits + PlayerPtr->Tiberium),
		power_produced,
		power_consumed);

	/* --- Friendly mobile units --- */
	buf_cat("\"units\":[");
	bool first = true;

	for (int i = 0; i < Units.Count(); i++) {
		UnitClass* u = Units.Ptr(i);
		if (!u || u->IsInLimbo || u->Strength <= 0) continue;
		if (!PlayerPtr->Is_Ally(u)) continue;
		serialize_obj((ObjectClass*)u, RTTI_UNIT, i, true, first);
		first = false;
	}
	for (int i = 0; i < Infantry.Count(); i++) {
		InfantryClass* inf = Infantry.Ptr(i);
		if (!inf || inf->IsInLimbo || inf->Strength <= 0) continue;
		if (!PlayerPtr->Is_Ally(inf)) continue;
		serialize_obj((ObjectClass*)inf, RTTI_INFANTRY, i, true, first);
		first = false;
	}
	for (int i = 0; i < Aircraft.Count(); i++) {
		AircraftClass* a = Aircraft.Ptr(i);
		if (!a || a->IsInLimbo || a->Strength <= 0) continue;
		if (!PlayerPtr->Is_Ally(a)) continue;
		serialize_obj((ObjectClass*)a, RTTI_AIRCRAFT, i, true, first);
		first = false;
	}
	for (int i = 0; i < Vessels.Count(); i++) {
		VesselClass* v = Vessels.Ptr(i);
		if (!v || v->IsInLimbo || v->Strength <= 0) continue;
		if (!PlayerPtr->Is_Ally(v)) continue;
		serialize_obj((ObjectClass*)v, RTTI_VESSEL, i, true, first);
		first = false;
	}
	buf_cat("],");

	/* --- Enemy mobile units --- */
	buf_cat("\"enemies\":[");
	first = true;

	for (int i = 0; i < Units.Count(); i++) {
		UnitClass* u = Units.Ptr(i);
		if (!u || u->IsInLimbo || u->Strength <= 0) continue;
		if (PlayerPtr->Is_Ally(u)) continue;
		serialize_obj((ObjectClass*)u, RTTI_UNIT, i, false, first);
		first = false;
	}
	for (int i = 0; i < Infantry.Count(); i++) {
		InfantryClass* inf = Infantry.Ptr(i);
		if (!inf || inf->IsInLimbo || inf->Strength <= 0) continue;
		if (PlayerPtr->Is_Ally(inf)) continue;
		serialize_obj((ObjectClass*)inf, RTTI_INFANTRY, i, false, first);
		first = false;
	}
	for (int i = 0; i < Aircraft.Count(); i++) {
		AircraftClass* a = Aircraft.Ptr(i);
		if (!a || a->IsInLimbo || a->Strength <= 0) continue;
		if (PlayerPtr->Is_Ally(a)) continue;
		serialize_obj((ObjectClass*)a, RTTI_AIRCRAFT, i, false, first);
		first = false;
	}
	for (int i = 0; i < Vessels.Count(); i++) {
		VesselClass* v = Vessels.Ptr(i);
		if (!v || v->IsInLimbo || v->Strength <= 0) continue;
		if (PlayerPtr->Is_Ally(v)) continue;
		serialize_obj((ObjectClass*)v, RTTI_VESSEL, i, false, first);
		first = false;
	}
	buf_cat("],");

	/* --- Structures (all sides) --- */
	buf_cat("\"structures\":[");
	first = true;
	for (int i = 0; i < Buildings.Count(); i++) {
		BuildingClass* b = Buildings.Ptr(i);
		if (!b || b->IsInLimbo || b->Strength <= 0) continue;

		bool ally = PlayerPtr->Is_Ally(b);
		if (!first) buf_cat(",");
		first = false;

		COORDINATE coord = b->Center_Coord();
		CELL cell = Coord_Cell(coord);

		buf_cat("{\"id\":%d,\"t\":\"%s\",\"cx\":%d,\"cy\":%d,\"hp\":%d,\"mhp\":%d,\"ally\":%s,\"repairing\":%s}",
			AGENT_ID(RTTI_BUILDING, i),
			b->Class_Of().Name(),
			Cell_X(cell), Cell_Y(cell),
			(int)b->Strength,
			(int)b->Class_Of().MaxStrength,
			ally ? "true" : "false",
			b->IsRepairing ? "true" : "false");
	}
	buf_cat("],");

	/* --- Production queues --- */
	buf_cat("\"production\":[");
	first = true;
	static const RTTIType prod_types[] = {
		RTTI_UNITTYPE, RTTI_INFANTRYTYPE, RTTI_AIRCRAFTTYPE,
		RTTI_VESSELTYPE, RTTI_BUILDINGTYPE
	};
	for (int f = 0; f < 5; f++) {
		FactoryClass* factory = PlayerPtr->Fetch_Factory(prod_types[f]);
		if (!factory) continue;
		TechnoClass* obj = factory->Get_Object();
		if (!obj) continue;
		if (!first) buf_cat(",");
		first = false;
		buf_cat("{\"t\":\"%s\",\"prog\":%d}",
			obj->Class_Of().Name(),
			factory->Completion());
	}
	buf_cat("]}");

	return s_state_buf;
}

/* ======================================================================
 * EXPORT 2: agent_command — process JSON command array
 * ====================================================================== */
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* agent_command(char* json)
{
	buf_init(s_cmd_buf, CMD_BUF_SIZE);

	AgentCmd cmds[16];
	int cmd_count = parse_commands(json, cmds, 16);

	buf_cat("[");
	for (int c = 0; c < cmd_count; c++) {
		if (c > 0) buf_cat(",");
		AgentCmd& cmd = cmds[c];

		bool any_ok = false;
		for (int i = 0; i < cmd.id_count; i++) {
			TechnoClass* tech = agent_lookup(cmd.ids[i]);
			if (!tech || tech->IsInLimbo || tech->Strength <= 0) continue;

			if (strcmp(cmd.cmd, "move") == 0 && cmd.has_cx && cmd.has_cy) {
				CELL cell = XY_Cell(cmd.cx, cmd.cy);
				TARGET dest = ::As_Target(cell);
				tech->Assign_Destination(dest);
				tech->Assign_Mission(MISSION_MOVE);
				any_ok = true;
			}
			else if (strcmp(cmd.cmd, "attack") == 0 && cmd.has_target) {
				TechnoClass* tgt = agent_lookup(cmd.target);
				if (tgt && !tgt->IsInLimbo && tgt->Strength > 0) {
					tech->Assign_Target(tgt->As_Target());
					tech->Assign_Mission(MISSION_ATTACK);
					any_ok = true;
				}
			}
			else if (strcmp(cmd.cmd, "attack_move") == 0 && cmd.has_cx && cmd.has_cy) {
				CELL cell = XY_Cell(cmd.cx, cmd.cy);
				TARGET dest = ::As_Target(cell);
				tech->Assign_Destination(dest);
				tech->Assign_Mission(MISSION_HUNT);
				any_ok = true;
			}
			else if (strcmp(cmd.cmd, "stop") == 0) {
				tech->Assign_Mission(MISSION_GUARD);
				any_ok = true;
			}
			else if (strcmp(cmd.cmd, "deploy") == 0) {
				tech->Assign_Mission(MISSION_UNLOAD);
				any_ok = true;
			}
		}

		buf_cat("{\"cmd\":\"%s\",\"ok\":%s}", cmd.cmd, any_ok ? "true" : "false");
	}
	buf_cat("]");

	return s_cmd_buf;
}

/* ======================================================================
 * EXPORT 3: agent_step — commands + tick + fresh state
 * ====================================================================== */
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* agent_step(int n, char* commands)
{
	/* Force autoplay mode — prevents emscripten_sleep in Main_Loop */
	g_autoplay_mode = 1;
	GameInFocus = true;

	/* 1. Process commands if provided */
	const char* results = "[]";
	if (commands && commands[0]) {
		agent_command(commands);
		results = s_cmd_buf;
	}

	/* 2. Run N game ticks */
	if (n < 1) n = 1;
	if (n > 300) n = 300;
	for (int i = 0; i < n; i++) {
		if (do_tick()) break;
	}

	/* 3. Get fresh state */
	agent_get_state();

	/* 4. Build combined output */
	buf_init(s_step_buf, STEP_BUF_SIZE);
	buf_cat("{\"results\":%s,\"state\":%s}", results, s_state_buf);

	return s_step_buf;
}

} /* extern "C" */
