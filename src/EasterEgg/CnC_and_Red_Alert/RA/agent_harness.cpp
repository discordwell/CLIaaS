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
#define STATE_BUF_SIZE 131072
#define CMD_BUF_SIZE   4096
#define STEP_BUF_SIZE  131072

static char s_state_buf[STATE_BUF_SIZE];
static char s_cmd_buf[CMD_BUF_SIZE];
static char s_step_buf[STEP_BUF_SIZE];
static VesselType s_agent_pending_vessel = VESSEL_NONE;
static long s_agent_pending_vessel_start = -1;
static long s_agent_pending_vessel_finish = -1;

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

static const char* agent_house_name(HousesType house)
{
	if (house < HOUSE_FIRST || house >= HOUSE_COUNT) return "None";
	return HouseTypeClass::As_Reference(house).Name();
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

static bool agent_place_structure(CELL cell)
{
	if (!PlayerPtr) return false;

	FactoryClass* factory = PlayerPtr->Fetch_Factory(RTTI_BUILDINGTYPE);
	if (!factory || !factory->Has_Completed()) return false;

	TechnoClass* tech = factory->Get_Object();
	if (!tech || tech->What_Am_I() != RTTI_BUILDING) return false;

#ifdef __EMSCRIPTEN__
	EM_ASM({
		if (window.__wlog) window.__wlog("agent_place_structure: try cell=" + $0);
	}, cell);
#endif

	if (!tech->Unlimbo(Cell_Coord(cell))) {
#ifdef __EMSCRIPTEN__
		EM_ASM({
			if (window.__wlog) window.__wlog("agent_place_structure: Unlimbo failed");
		});
#endif
		return false;
	}

	factory->Completed();
	PlayerPtr->Abandon_Production(RTTI_BUILDINGTYPE);
	Map.Set_Cursor_Shape(0);
	Map.PendingObjectPtr = 0;
	Map.PendingObject = 0;
	Map.PendingHouse = HOUSE_NONE;

#ifdef __EMSCRIPTEN__
	EM_ASM({
		if (window.__wlog) window.__wlog("agent_place_structure: success");
	});
#endif

	return true;
}

static const char* agent_factory_item_name(FactoryClass* factory, RTTIType rtti)
{
	if (!factory) return NULL;

	/*
	** Vessel production becomes unstable if we dereference the pending limbo
	** object just to print its class name. The oracle only needs to know that
	** a vessel factory is busy, so fall back to a safe generic label there.
	*/
	if (rtti == RTTI_VESSELTYPE) {
		if (s_agent_pending_vessel != VESSEL_NONE) {
			return VesselTypeClass::As_Reference(s_agent_pending_vessel).Name();
		}
		if (PlayerPtr && PlayerPtr->BuildVessel != VESSEL_NONE) {
			return VesselTypeClass::As_Reference(PlayerPtr->BuildVessel).Name();
		}
		if (PlayerPtr && PlayerPtr->JustBuiltVessel != VESSEL_NONE) {
			return VesselTypeClass::As_Reference(PlayerPtr->JustBuiltVessel).Name();
		}
		return "VESSEL";
	}

	TechnoClass* obj = factory->Get_Object();
	if (!obj) return NULL;
	return obj->Class_Of().Name();
}

static const char* agent_pending_vessel_name(VesselType type)
{
	switch (type) {
		case VESSEL_SS: return "SS";
		case VESSEL_DD: return "DD";
		case VESSEL_CA: return "CA";
		case VESSEL_TRANSPORT: return "LST";
		case VESSEL_PT: return "PT";
		case VESSEL_MISSILESUB: return "MSUB";
		default: return "VESSEL";
	}
}

static int agent_pending_vessel_build_time(VesselType type)
{
	switch (type) {
		case VESSEL_SS: return 700;
		case VESSEL_DD: return 900;
		case VESSEL_CA: return 1200;
		case VESSEL_TRANSPORT: return 700;
		case VESSEL_PT: return 500;
		case VESSEL_MISSILESUB: return 1100;
		default: return 900;
	}
}

static void agent_clear_pending_vessel(void)
{
	s_agent_pending_vessel = VESSEL_NONE;
	s_agent_pending_vessel_start = -1;
	s_agent_pending_vessel_finish = -1;
}

static bool agent_pending_vessel_done(void)
{
	return s_agent_pending_vessel != VESSEL_NONE &&
		s_agent_pending_vessel_finish >= 0 &&
		Frame >= s_agent_pending_vessel_finish;
}

static BuildingClass* agent_find_player_naval_yard(void)
{
	if (!PlayerPtr) return NULL;

	BuildingClass* fallback = NULL;
	for (int i = 0; i < Buildings.Count(); i++) {
		BuildingClass* b = Buildings.Ptr(i);
		if (!b || b->IsInLimbo || b->Strength <= 0) continue;
		if (!PlayerPtr->Is_Ally(b)) continue;

		if (b->Class->Type == STRUCT_SHIP_YARD || b->Class->Type == STRUCT_SUB_PEN) {
			if (b->Owner() == PlayerPtr->Class->House) return b;
			if (!fallback) fallback = b;
		}
	}

	return fallback;
}

static bool agent_try_place_pending_vessel(CELL cell)
{
	if (!PlayerPtr || cell == -1 || s_agent_pending_vessel == VESSEL_NONE) return false;

	VesselClass* vessel = new VesselClass(s_agent_pending_vessel, PlayerPtr->Class->House);
	if (!vessel) return false;

	if (vessel->Unlimbo(Cell_Coord(cell), Random_Pick(DIR_N, DIR_MAX))) {
		PlayerPtr->IsBuiltSomething = true;
		agent_clear_pending_vessel();
		return true;
	}

	delete vessel;
	return false;
}

static bool agent_launch_pending_vessel(CELL preferred_cell)
{
	if (!PlayerPtr || s_agent_pending_vessel == VESSEL_NONE) return false;
	if (!agent_pending_vessel_done()) return false;

	BuildingClass* yard = agent_find_player_naval_yard();
	if (!yard) return false;

	if (preferred_cell != -1 && agent_try_place_pending_vessel(preferred_cell)) return true;

	CELL yard_cell = Coord_Cell(yard->Center_Coord());
	int base_x = Cell_X(yard_cell);
	int base_y = Cell_Y(yard_cell);

	for (int radius = 1; radius <= 10; radius++) {
		for (int dy = -radius; dy <= radius; dy++) {
			for (int dx = -radius; dx <= radius; dx++) {
				if (dx != -radius && dx != radius && dy != -radius && dy != radius) continue;
				int cx = base_x + dx;
				int cy = base_y + dy;
				if (cx < 1 || cx >= MAP_CELL_W - 1 || cy < 1 || cy >= MAP_CELL_H - 1) continue;
				CELL cell = XY_Cell(cx, cy);
				if (Map[cell].Land_Type() != LAND_WATER) continue;
				if (agent_try_place_pending_vessel(cell)) return true;
			}
		}
	}

	return false;
}

/* --- Serialize one object as JSON into the active buffer --- */
static void serialize_obj(ObjectClass* obj, RTTIType rtti, int idx, bool ally, bool is_first)
{
	if (!is_first) buf_cat(",");

	COORDINATE coord = obj->Center_Coord();
	CELL cell = Coord_Cell(coord);
	HousesType house = obj->Owner();
	TechnoClass* tech = (TechnoClass*)obj;

	buf_cat("{\"id\":%d,\"t\":\"%s\",\"house\":\"%s\",\"cx\":%d,\"cy\":%d,\"hp\":%d,\"mhp\":%d,\"m\":%d,\"ally\":%s",
		AGENT_ID(rtti, idx),
		obj->Class_Of().Name(),
		agent_house_name(house),
		Cell_X(cell), Cell_Y(cell),
		(int)obj->Strength,
		(int)obj->Class_Of().MaxStrength,
		(int)obj->Get_Mission(),
		ally ? "true" : "false");

	if (tech->Techno_Type_Class()->Max_Passengers() > 0) {
		buf_cat(",\"cargo\":%d", tech->How_Many());
		if (tech->Is_Something_Attached()) {
			FootClass* passenger = tech->Attached_Object();
			if (passenger) {
				buf_cat(",\"cargoTop\":\"%s\"", passenger->Class_Of().Name());
			}
		}
	}

	/* Expose ammo count for minelayer and other ammo-using units */
	if (tech->Techno_Type_Class()->MaxAmmo > 0) {
		buf_cat(",\"ammo\":%d,\"maxAmmo\":%d", tech->Ammo, tech->Techno_Type_Class()->MaxAmmo);
	}

	buf_cat("}");
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
	int  rtti;
	int  type_id;
	bool has_cx, has_cy, has_target;
	bool has_rtti, has_type_id;
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
			} else if (strcmp(key, "rtti") == 0) {
				p = jp_int(p, &c.rtti);
				c.has_rtti = true;
			} else if (strcmp(key, "type_id") == 0) {
				p = jp_int(p, &c.type_id);
				c.has_type_id = true;
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
		agent_clear_pending_vessel();
		buf_cat("{\"error\":\"no player\"}");
		return s_state_buf;
	}

	if (s_agent_pending_vessel != VESSEL_NONE && s_agent_pending_vessel_start > Frame) {
		agent_clear_pending_vessel();
	}

	HousesType player_house = PlayerPtr->Class->House;
	int power_produced = agent_power_produced();
	int power_consumed = agent_power_consumed();

	extern unsigned long g_rng_call_count;
	extern RandomClass * g_rng_tracked_instance;
	// Lazily set tracked instance on first state read
	if (!g_rng_tracked_instance) g_rng_tracked_instance = &Scen.RandomNumber;
	buf_cat("{\"tick\":%ld,\"credits\":%ld,\"playerHouse\":\"%s\",\"rngState\":%lu,\"rngCalls\":%lu,",
		Frame,
		(long)(PlayerPtr->Credits + PlayerPtr->Tiberium),
		agent_house_name(player_house),
		Scen.RandomNumber.Seed,
		g_rng_call_count);

	buf_cat("\"alliedHouses\":[");
	bool first = true;
	for (HousesType house = HOUSE_FIRST; house < HOUSE_COUNT; house++) {
		if (!PlayerPtr->Is_Ally(house)) continue;
		if (!first) buf_cat(",");
		first = false;
		buf_cat("\"%s\"", agent_house_name(house));
	}
	buf_cat("],");

	buf_cat("\"globals\":[");
	first = true;
	for (int global = 0; global < (int)ARRAY_SIZE(Scen.GlobalFlags); global++) {
		if (!Scen.GlobalFlags[global]) continue;
		if (!first) buf_cat(",");
		first = false;
		buf_cat("%d", global);
	}
	buf_cat("],");

	buf_cat("\"missionTimer\":%ld,", (long)Scen.MissionTimer);
	buf_cat("\"missionTimerActive\":%s,", Scen.MissionTimer.Is_Active() ? "true" : "false");
	buf_cat("\"civEvacuated\":%s,", PlayerPtr->IsCivEvacuated ? "true" : "false");
	buf_cat("\"winPending\":%s,", PlayerPtr->IsToWin ? "true" : "false");
	buf_cat("\"losePending\":%s,", PlayerPtr->IsToLose ? "true" : "false");

	buf_cat("\"power\":{\"produced\":%d,\"consumed\":%d},",
		power_produced,
		power_consumed);

	/* --- Friendly mobile units --- */
	buf_cat("\"units\":[");
	first = true;

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
		HousesType house = b->Owner();

		buf_cat("{\"id\":%d,\"t\":\"%s\",\"house\":\"%s\",\"cx\":%d,\"cy\":%d,\"hp\":%d,\"mhp\":%d,\"ally\":%s,\"repairing\":%s}",
			AGENT_ID(RTTI_BUILDING, i),
			b->Class_Of().Name(),
			agent_house_name(house),
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
		if (prod_types[f] == RTTI_VESSELTYPE && s_agent_pending_vessel != VESSEL_NONE) {
			int progress = 0;
			long duration = s_agent_pending_vessel_finish - s_agent_pending_vessel_start;
			if (duration > 0) {
				long elapsed = Frame - s_agent_pending_vessel_start;
				if (elapsed < 0) elapsed = 0;
				if (elapsed > duration) elapsed = duration;
				progress = (int)((elapsed * FactoryClass::STEP_COUNT) / duration);
			}
			if (progress > FactoryClass::STEP_COUNT) progress = FactoryClass::STEP_COUNT;
			if (!first) buf_cat(",");
			first = false;
			buf_cat("{\"t\":\"%s\",\"prog\":%d,\"rtti\":%d,\"done\":%s}",
				agent_pending_vessel_name(s_agent_pending_vessel),
				progress,
				(int)RTTI_VESSELTYPE,
				agent_pending_vessel_done() ? "true" : "false");
			continue;
		}
		FactoryClass* factory = PlayerPtr->Fetch_Factory(prod_types[f]);
		if (!factory) continue;
		const char* prod_name = agent_factory_item_name(factory, prod_types[f]);
		if (!prod_name) continue;
		if (!first) buf_cat(",");
		first = false;
		buf_cat("{\"t\":\"%s\",\"prog\":%d,\"rtti\":%d,\"done\":%s}",
			prod_name,
			factory->Completion(),
			(int)prod_types[f],
			factory->Has_Completed() ? "true" : "false");
	}
	buf_cat("],");

	/* --- Buildable items --- */
	buf_cat("\"buildable\":{\"structures\":[");
	first = true;
	for (int s = STRUCT_FIRST; s < STRUCT_COUNT; s++) {
		BuildingTypeClass const & btype = BuildingTypeClass::As_Reference((StructType)s);
		if (PlayerPtr->Can_Build(&btype, PlayerPtr->ActLike)) {
			if (!first) buf_cat(",");
			first = false;
			buf_cat("\"%s\"", btype.Name());
		}
	}
	buf_cat("],\"units\":[");
	first = true;
	for (int u = UNIT_FIRST; u < UNIT_COUNT; u++) {
		UnitTypeClass const & utype = UnitTypeClass::As_Reference((UnitType)u);
		if (PlayerPtr->Can_Build(&utype, PlayerPtr->ActLike)) {
			if (!first) buf_cat(",");
			first = false;
			buf_cat("\"%s\"", utype.Name());
		}
	}
	buf_cat("],\"infantry\":[");
	first = true;
	for (int inf = INFANTRY_FIRST; inf < INFANTRY_COUNT; inf++) {
		InfantryTypeClass const & itype = InfantryTypeClass::As_Reference((InfantryType)inf);
		if (PlayerPtr->Can_Build(&itype, PlayerPtr->ActLike)) {
			if (!first) buf_cat(",");
			first = false;
			buf_cat("\"%s\"", itype.Name());
		}
	}
	buf_cat("],\"aircraft\":[");
	first = true;
	for (int a = AIRCRAFT_FIRST; a < AIRCRAFT_COUNT; a++) {
		AircraftTypeClass const & atype = AircraftTypeClass::As_Reference((AircraftType)a);
		if (PlayerPtr->Can_Build(&atype, PlayerPtr->ActLike)) {
			if (!first) buf_cat(",");
			first = false;
			buf_cat("\"%s\"", atype.Name());
		}
	}
	buf_cat("],\"vessels\":[");
	first = true;
	bool has_shipyard = false;
	bool has_subpen = false;
	for (int i = 0; i < Buildings.Count(); i++) {
		BuildingClass* b = Buildings.Ptr(i);
		if (!b || b->IsInLimbo || b->Strength <= 0) continue;
		if (!PlayerPtr->Is_Ally(b)) continue;
		if (b->Class->Type == STRUCT_SHIP_YARD) has_shipyard = true;
		if (b->Class->Type == STRUCT_SUB_PEN) has_subpen = true;
	}

	/*
	** Querying Can_Build() across all vessel types destabilizes the WASM runtime
	** once naval production is active. Emit a conservative vessel catalog based
	** on the owned naval production structure instead.
	*/
	if (has_shipyard) {
		static const char* allied_vessels[] = { "DD", "LST", "PT" };
		for (int i = 0; i < 3; i++) {
			if (!first) buf_cat(",");
			first = false;
			buf_cat("\"%s\"", allied_vessels[i]);
		}
	} else if (has_subpen) {
		static const char* soviet_vessels[] = { "SS", "LST", "MSUB" };
		for (int i = 0; i < 3; i++) {
			if (!first) buf_cat(",");
			first = false;
			buf_cat("\"%s\"", soviet_vessels[i]);
		}
	} else {
		for (int v = VESSEL_FIRST; v < VESSEL_COUNT; v++) {
			VesselTypeClass const & vtype = VesselTypeClass::As_Reference((VesselType)v);
			if (PlayerPtr->Can_Build(&vtype, PlayerPtr->ActLike)) {
				if (!first) buf_cat(",");
				first = false;
				buf_cat("\"%s\"", vtype.Name());
			}
		}
	}
	buf_cat("]},");

	/* --- Coastal cells (land cells adjacent to water, near player base) --- */
	buf_cat("\"coastalCells\":[");

	/* Find base center: ConYard position or centroid of allied structures */
	int base_cx = 64, base_cy = 64;
	int struct_count = 0;
	long sum_cx = 0, sum_cy = 0;
	for (int i = 0; i < Buildings.Count(); i++) {
		BuildingClass* b = Buildings.Ptr(i);
		if (!b || b->IsInLimbo || b->Strength <= 0) continue;
		if (!PlayerPtr->Is_Ally(b)) continue;
		COORDINATE coord = b->Center_Coord();
		CELL cell = Coord_Cell(coord);
		sum_cx += Cell_X(cell);
		sum_cy += Cell_Y(cell);
		struct_count++;
		/* Prefer ConYard as center */
		if (b->Class->Type == STRUCT_CONST) {
			base_cx = Cell_X(cell);
			base_cy = Cell_Y(cell);
		}
	}
	if (struct_count > 0 && base_cx == 64 && base_cy == 64) {
		/* No ConYard found — use centroid */
		base_cx = (int)(sum_cx / struct_count);
		base_cy = (int)(sum_cy / struct_count);
	}

	int coastal_count = 0;
	first = true;
	for (int dy = -20; dy <= 20 && coastal_count < 10; dy++) {
		for (int dx = -20; dx <= 20 && coastal_count < 10; dx++) {
			int cx = base_cx + dx;
			int cy = base_cy + dy;
			if (cx < 1 || cx >= MAP_CELL_W - 1 || cy < 1 || cy >= MAP_CELL_H - 1) continue;
			CELL cell = XY_Cell(cx, cy);
			/* Must be buildable land (not water itself) */
			if (Map[cell].Land_Type() == LAND_WATER) continue;
			if (Map[cell].Land_Type() == LAND_ROCK) continue;
			/* Check 4 cardinal neighbors for water */
			bool has_water = false;
			CELL north = XY_Cell(cx, cy - 1);
			CELL south = XY_Cell(cx, cy + 1);
			CELL west  = XY_Cell(cx - 1, cy);
			CELL east  = XY_Cell(cx + 1, cy);
			if (Map[north].Land_Type() == LAND_WATER) has_water = true;
			if (Map[south].Land_Type() == LAND_WATER) has_water = true;
			if (Map[west].Land_Type()  == LAND_WATER) has_water = true;
			if (Map[east].Land_Type()  == LAND_WATER) has_water = true;
			if (!has_water) continue;

			if (!first) buf_cat(",");
			first = false;
			buf_cat("{\"cx\":%d,\"cy\":%d}", cx, cy);
			coastal_count++;
		}
	}

	buf_cat("]}");

	return s_state_buf;
}

/* ======================================================================
 * EXPORT 1b: dedicated vessel commands to avoid JSON/command bridge trap
 * ====================================================================== */
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int agent_vessel_produce(int type_id)
{
	if (s_agent_pending_vessel != VESSEL_NONE) return 0;
	s_agent_pending_vessel = (VesselType)type_id;
	s_agent_pending_vessel_start = Frame;
	s_agent_pending_vessel_finish = Frame + agent_pending_vessel_build_time(s_agent_pending_vessel);
	return 1;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int agent_vessel_place(int cx, int cy)
{
	CELL cell = -1;
	if (cx >= 0 && cy >= 0) {
		cell = XY_Cell(cx, cy);
	}
	return agent_launch_pending_vessel(cell) ? 1 : 0;
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

		/* --- produce/place run once per command, not per-id --- */
		if (strcmp(cmd.cmd, "produce") == 0 && cmd.has_rtti && cmd.has_type_id && PlayerPtr) {
			ProdFailType result;
			if ((RTTIType)cmd.rtti == RTTI_VESSELTYPE) {
				/*
				** Keep naval production entirely inside harness state. The original
				** ship build path traps in the headless WASM runtime.
				*/
				if (s_agent_pending_vessel == VESSEL_NONE) {
					s_agent_pending_vessel = (VesselType)cmd.type_id;
					s_agent_pending_vessel_start = Frame;
					s_agent_pending_vessel_finish = Frame + agent_pending_vessel_build_time(s_agent_pending_vessel);
					result = PROD_OK;
				} else {
					result = PROD_CANT;
				}
			} else {
				result = PlayerPtr->Begin_Production((RTTIType)cmd.rtti, cmd.type_id);
			}
			any_ok = (result == PROD_OK);
		}
		else if (strcmp(cmd.cmd, "place") == 0 && cmd.has_rtti && PlayerPtr) {
			CELL cell = -1;
			if (cmd.has_cx && cmd.has_cy) {
				cell = XY_Cell(cmd.cx, cmd.cy);
			}
			if ((RTTIType)cmd.rtti == RTTI_BUILDINGTYPE && cell != -1) {
				any_ok = agent_place_structure(cell);
			} else if ((RTTIType)cmd.rtti == RTTI_VESSELTYPE) {
				any_ok = agent_launch_pending_vessel(cell);
			} else {
				any_ok = PlayerPtr->Place_Object((RTTIType)cmd.rtti, cell);
			}
		}
		else {
			/* --- per-id commands --- */
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
				else if (strcmp(cmd.cmd, "enter") == 0 && cmd.has_target) {
					TechnoClass* tgt = agent_lookup(cmd.target);
					if (tgt && !tgt->IsInLimbo && tgt->Strength > 0) {
						tech->Assign_Target(TARGET_NONE);
						tech->Assign_Destination(tgt->As_Target());
						tech->Assign_Mission(MISSION_ENTER);
						any_ok = true;
					}
				}
				else if (strcmp(cmd.cmd, "stop") == 0) {
					tech->Assign_Mission(MISSION_GUARD);
					any_ok = true;
				}
				else if (strcmp(cmd.cmd, "deploy") == 0) {
					/* For MCVs, use MISSION_HUNT which calls Goto_Clear_Spot()
					** to find a valid deployment location automatically.
					** MISSION_UNLOAD tries the current cell and fails silently
					** if blocked. */
					if (tech->What_Am_I() == RTTI_UNIT &&
						((UnitClass *)tech)->Class->Type == UNIT_MCV) {
						tech->Assign_Mission(MISSION_HUNT);
					} else {
						tech->Assign_Mission(MISSION_UNLOAD);
					}
					any_ok = true;
				}
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
