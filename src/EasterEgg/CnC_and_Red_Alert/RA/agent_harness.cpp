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

/* ============================================================================
 * Phase 0 instrumentation — PCP / Commence / Mission-dispatch / Enter_Idle tags
 * (JOINT-REFACTOR-ALL-DIVERGENCES-PLAN.md §0 line 137-141).
 *
 * These globals are declared `extern "C"` here so that a future rebuild with
 * access to the full RA source tree (unit.cpp, infantry.cpp, drive.cpp,
 * mission.cpp, foot.cpp) can wire them at the call sites listed below. They
 * mirror the existing `g_rng_source_tag` instrumentation pattern (defined in
 * logic.cpp inside the full source, not in this repo's slice).
 *
 * Intended wiring (documentation only until full source is available):
 *   g_pcp_call_tag       = 80000 + pcp_type  BEFORE every Per_Cell_Process
 *                          call (drive.cpp:735 PCP_DURING, drive.cpp:773 +
 *                          drive.cpp:816 PCP_END, drive.cpp:1365 PCP_ROTATION).
 *   g_commence_pop_tag   = 80100 + popped_mission  BEFORE every Commence()
 *                          that actually pops MissionQueue (mission.cpp:343-359).
 *   g_mission_dispatch_tag = 80200 + mission  BEFORE every MissionClass::AI
 *                          Timer==0 dispatch branch (mission.cpp:213-321).
 *   g_enter_idle_tag     = 80300  BEFORE every Enter_Idle_Mode call (the
 *                          InfantryClass / FootClass overrides).
 *
 * CONSTRAINT: This repo contains only agent_harness.cpp, aircraft.cpp,
 * random.cpp, and input_inject.cpp from the RA source tree. The actual
 * Per_Cell_Process / Commence / MissionClass::AI / Enter_Idle_Mode functions
 * live in unit.cpp / drive.cpp / infantry.cpp / mission.cpp / foot.cpp, which
 * are NOT in the repository. Therefore these variables are declared but NOT
 * wired to any call site. No WASM rebuild is required for this change — the
 * existing binary contains zero references to these globals. A future
 * integration with the full source will provide the set-sites; diagnostic
 * scripts can then read these via a new `agent_get_state` field.
 * ============================================================================ */
extern "C" {
	int g_pcp_call_tag = 0;
	int g_commence_pop_tag = 0;
	int g_mission_dispatch_tag = 0;
	int g_enter_idle_tag = 0;
	int g_nav_clear_site_id = 0;
		int g_cover_coord_move_target_x = 0;
		int g_cover_coord_move_target_y = 0;
		int g_cover_coord_move_mission_target_x = 0;
		int g_cover_coord_move_mission_target_y = 0;
		int g_agent_overlay_read_window[21] = {0};
		int g_agent_team_remove_site = 0;
		int g_agent_tarcom_count = 0;
		int g_agent_tarcom_frame[128] = {0};
		int g_agent_tarcom_tag_log[128] = {0};
		int g_agent_tarcom_self_type[128] = {0};
		int g_agent_tarcom_self_x[128] = {0};
		int g_agent_tarcom_self_y[128] = {0};
		int g_agent_tarcom_mission[128] = {0};
		int g_agent_tarcom_prev_kind[128] = {0};
		int g_agent_tarcom_prev_value[128] = {0};
		int g_agent_tarcom_new_kind[128] = {0};
		int g_agent_tarcom_new_value[128] = {0};
		int g_agent_tarcom_target_rtti[128] = {0};
		int g_agent_tarcom_target_type[128] = {0};
		int g_agent_tarcom_target_x[128] = {0};
		int g_agent_tarcom_target_y[128] = {0};
		int g_agent_tarcom_fire_x[128] = {0};
		int g_agent_tarcom_fire_y[128] = {0};
		int g_agent_tarcom_in_range0[128] = {0};
	}

struct DebugBulletScatterEntry {
	int frame, bulletId, bulletType, warhead, paybackRtti, maxSpeed;
	int coordX, coordY, targetX, targetY;
	int paybackX, paybackY;
};
static DebugBulletScatterEntry g_debug_bullet_scatters[64];
static int g_debug_bullet_scatter_idx = 0;
static int g_debug_bullet_scatter_count = 0;

extern "C" void agent_debug_bullet_scatter(int frame, int bulletId, int bulletType,
	int warhead, int paybackRtti, int maxSpeed, int coordX, int coordY, int targetX, int targetY,
	int paybackX, int paybackY)
{
	auto &e = g_debug_bullet_scatters[g_debug_bullet_scatter_idx % 64];
	e.frame = frame;
	e.bulletId = bulletId;
	e.bulletType = bulletType;
	e.warhead = warhead;
	e.paybackRtti = paybackRtti;
	e.maxSpeed = maxSpeed;
	e.coordX = coordX;
	e.coordY = coordY;
	e.targetX = targetX;
	e.targetY = targetY;
	e.paybackX = paybackX;
	e.paybackY = paybackY;
	g_debug_bullet_scatter_idx++;
	if (g_debug_bullet_scatter_count < 64) g_debug_bullet_scatter_count++;
}

// Debug movement log — ring buffer of last 32 entries
struct DebugMoveEntry { int preLX, preLY, postLX, postLY, dir, dist, headLX, headLY; };
static DebugMoveEntry g_debug_moves[256];
static int g_debug_move_idx = 0;
static int g_debug_move_count = 0;

void agent_debug_log(int a, int b, int c, int d, int e, int f, int g, int h) {
	auto &e2 = g_debug_moves[g_debug_move_idx % 256];
	e2.preLX = a; e2.preLY = b; e2.postLX = c; e2.postLY = d;
	e2.dir = e; e2.dist = f; e2.headLX = g; e2.headLY = h;
	g_debug_move_idx++;
	if (g_debug_move_count < 256) g_debug_move_count++;
}

struct DebugTeamRemoveEntry {
	int frame, teamIndex, rtti, index, site, totalBefore, currentMission, cellX, cellY;
};
static DebugTeamRemoveEntry g_debug_team_removes[128];
static int g_debug_team_remove_idx = 0;
static int g_debug_team_remove_count = 0;

extern "C" void agent_debug_team_remove(int frame, int teamIndex,
	int rtti, int index, int site, int totalBefore, int currentMission, int cellX, int cellY)
{
	auto &e = g_debug_team_removes[g_debug_team_remove_idx % 128];
	e.frame = frame;
	e.teamIndex = teamIndex;
	e.rtti = rtti;
	e.index = index;
	e.site = site;
	e.totalBefore = totalBefore;
	e.currentMission = currentMission;
	e.cellX = cellX;
	e.cellY = cellY;
	g_debug_team_remove_idx++;
	if (g_debug_team_remove_count < 128) g_debug_team_remove_count++;
}

/* --- ID encoding: (rtti << 16) | heap_index --- */
#define AGENT_ID(rtti, idx) (((int)(rtti) << 16) | (idx))
#define AGENT_RTTI(id)      ((RTTIType)((id) >> 16))
#define AGENT_IDX(id)       ((id) & 0xFFFF)

/* --- Static output buffers --- */
#define STATE_BUF_SIZE 524288
#define CMD_BUF_SIZE   4096
#define STEP_BUF_SIZE  524288

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

static int agent_object_index(ObjectClass* obj, RTTIType rtti)
{
	switch (rtti) {
		case RTTI_UNIT:
			for (int i = 0; i < Units.Count(); i++) {
				if ((ObjectClass*)Units.Ptr(i) == obj) return i;
			}
			break;
		case RTTI_INFANTRY:
			for (int i = 0; i < Infantry.Count(); i++) {
				if ((ObjectClass*)Infantry.Ptr(i) == obj) return i;
			}
			break;
		case RTTI_AIRCRAFT:
			for (int i = 0; i < Aircraft.Count(); i++) {
				if ((ObjectClass*)Aircraft.Ptr(i) == obj) return i;
			}
			break;
		case RTTI_BUILDING:
			for (int i = 0; i < Buildings.Count(); i++) {
				if ((ObjectClass*)Buildings.Ptr(i) == obj) return i;
			}
			break;
		case RTTI_VESSEL:
			for (int i = 0; i < Vessels.Count(); i++) {
				if ((ObjectClass*)Vessels.Ptr(i) == obj) return i;
			}
			break;
		default:
			break;
	}
	return -1;
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
		COORDINATE raw_coord = obj->Coord;
	CELL cell = Coord_Cell(coord);
	HousesType house = obj->Owner();
	TechnoClass* tech = (TechnoClass*)obj;
		buf_cat("{\"id\":%d,\"t\":\"%s\",\"house\":\"%s\",\"cx\":%d,\"cy\":%d,\"hp\":%d,\"mhp\":%d,\"m\":%d,\"ally\":%s,\"lx\":%d,\"ly\":%d,\"tcx\":%d,\"tcy\":%d,\"op\":%s,\"dp\":%s,\"vis\":%s,\"map\":%s",
			AGENT_ID(rtti, idx),
			obj->Class_Of().Name(),
			agent_house_name(house),
			Cell_X(cell), Cell_Y(cell),
			(int)obj->Strength,
			(int)obj->Class_Of().MaxStrength,
			(int)obj->Get_Mission(),
			ally ? "true" : "false",
			(int)Coord_X(coord), (int)Coord_Y(coord),
			(int)Coord_X(coord), (int)Coord_Y(coord),
			tech->IsOwnedByPlayer ? "true" : "false",
			tech->IsDiscoveredByPlayer ? "true" : "false",
			Map[cell].IsVisible ? "true" : "false",
			Map[cell].IsMapped ? "true" : "false");
			buf_cat(",\"lock\":%s,\"rawM\":%d,\"rawQ\":%d,\"mt\":%d,\"lock\":%s,\"cloak\":%d,\"stage\":%d,\"rate\":%d,\"cstage\":%d,\"crate\":%d,\"cdelay\":%d,\"readyCloak\":%s",
					tech->IsLocked ? "true" : "false",
					(int)tech->Mission,
					(int)tech->MissionQueue,
					(int)tech->Get_Mission_Timer_Value(),
					tech->IsLocked ? "true" : "false",
					(int)tech->Cloak,
					tech->Fetch_Stage(),
					tech->Fetch_Rate(),
					tech->CloakingDevice.Fetch_Stage(),
				tech->CloakingDevice.Fetch_Rate(),
				(int)tech->CloakDelay.Value(),
				tech->Is_Ready_To_Cloak() ? "true" : "false");

	// Export target and navcom info for parity debugging
	if (rtti == RTTI_INFANTRY || rtti == RTTI_UNIT || rtti == RTTI_AIRCRAFT || rtti == RTTI_VESSEL) {
		FootClass* foot = (FootClass*)obj;
		WeaponTypeClass const* primary = NULL;
		if (rtti == RTTI_INFANTRY) {
			primary = ((InfantryClass*)obj)->Class->PrimaryWeapon;
		} else if (rtti == RTTI_UNIT) {
			primary = ((UnitClass*)obj)->Class->PrimaryWeapon;
		} else if (rtti == RTTI_AIRCRAFT) {
			primary = ((AircraftClass*)obj)->Class->PrimaryWeapon;
		} else if (rtti == RTTI_VESSEL) {
			primary = ((VesselClass*)obj)->Class->PrimaryWeapon;
		}
		if (primary != NULL) {
			buf_cat(",\"rawx\":%d,\"rawy\":%d,\"rawcx\":%d,\"rawcy\":%d",
				(int)Coord_X(raw_coord), (int)Coord_Y(raw_coord),
				Cell_X(Coord_Cell(raw_coord)), Cell_Y(Coord_Cell(raw_coord)));
			buf_cat(",\"wpn\":\"%s\",\"sup\":%s",
				primary->Name(),
				primary->IsSupressed ? "true" : "false");
		}
		COORDINATE fc0 = tech->Fire_Coord(0);
		buf_cat(",\"fcx\":%d,\"fcy\":%d,\"wr0\":%d,\"wr1\":%d,\"tr0\":%d,\"tr1\":%d",
			(int)Coord_X(fc0), (int)Coord_Y(fc0),
			(int)tech->Weapon_Range(0), (int)tech->Weapon_Range(1),
			(int)tech->Threat_Range(0), (int)tech->Threat_Range(1));
		MZoneType move_zone = tech->Techno_Type_Class()->MZone;
		int cur_zone = (int)Map[Coord_Cell(tech->Center_Coord())].Zones[move_zone];
		int tar_zone = -1;
		int same_zone = -1;
		if (Target_Legal(foot->TarCom)) {
			COORDINATE tc = As_Coord(foot->TarCom);
			buf_cat(",\"tlx\":%d,\"tly\":%d", (int)Coord_X(tc), (int)Coord_Y(tc));
			CELL tcell = As_Cell(foot->TarCom);
			tar_zone = (int)Map[tcell].Zones[move_zone];
			same_zone = tech->Is_In_Same_Zone(tcell) ? 1 : 0;
		}
		buf_cat(",\"mzone\":%d,\"czone\":%d,\"tzone\":%d,\"sameZone\":%d",
			(int)move_zone, cur_zone, tar_zone, same_zone);
		if (Target_Legal(foot->NavCom)) {
			COORDINATE nc = As_Coord(foot->NavCom);
			buf_cat(",\"nlx\":%d,\"nly\":%d", (int)Coord_X(nc), (int)Coord_Y(nc));
			CELL ncell = As_Cell(foot->NavCom);
			int nav_zone = (int)Map[ncell].Zones[move_zone];
			int nav_enter = -1;
			if (rtti == RTTI_INFANTRY) {
				nav_enter = (int)((InfantryClass*)obj)->Can_Enter_Cell(ncell);
			} else if (rtti == RTTI_UNIT) {
				nav_enter = (int)((UnitClass*)obj)->Can_Enter_Cell(ncell);
			} else if (rtti == RTTI_VESSEL) {
				nav_enter = (int)((VesselClass*)obj)->Can_Enter_Cell(ncell);
			}
			int bp_dist = (int)foot->Distance(foot->NavCom);
			int bp_checkdist = foot->Team.Is_Valid() ? Rule.StrayDistance : Rule.CloseEnoughDistance;
			CELL bp_near = 0;
			if (nav_enter > MOVE_CLOAK && bp_dist > bp_checkdist) {
				bp_near = Map.Nearby_Location(ncell, tech->Techno_Type_Class()->Speed,
					Map[Coord_Cell(tech->Center_Coord())].Zones[move_zone], move_zone);
			}
			buf_cat(",\"ncx\":%d,\"ncy\":%d,\"nzone\":%d,\"nenter\":%d,\"bpdist\":%d,\"bpcheck\":%d,\"bpnx\":%d,\"bpny\":%d",
				Cell_X(ncell), Cell_Y(ncell), nav_zone, nav_enter, bp_dist, bp_checkdist,
				bp_near ? Cell_X(bp_near) : -1, bp_near ? Cell_Y(bp_near) : -1);
		}
		COORDINATE hc = foot->Head_To_Coord();
		if (hc) {
			buf_cat(",\"hlx\":%d,\"hly\":%d", (int)Coord_X(hc), (int)Coord_Y(hc));
		}
		int agentMaxSpeed = min(tech->Techno_Type_Class()->MaxSpeed * foot->SpeedBias * foot->House->GroundspeedBias, (int)MPH_LIGHT_SPEED);
		if (foot->IsFormationMove) agentMaxSpeed = foot->FormationMaxSpeed;
		int agentSpeedAdd = agentMaxSpeed * fixed(foot->Speed, 256);
		int assignDestStopClear = Map[foot->Center_Coord()].Is_Clear_To_Move(tech->Techno_Type_Class()->Speed, true, false) ? 1 : 0;
		int secondaryCurrent = -1;
		int secondaryDesired = -1;
		bool isTurretEquipped = false;
		if (rtti == RTTI_UNIT) {
			secondaryCurrent = (int)((UnitClass*)obj)->SecondaryFacing.Current();
			secondaryDesired = (int)((UnitClass*)obj)->SecondaryFacing.Desired();
			isTurretEquipped = ((UnitClass*)obj)->Class->IsTurretEquipped;
		} else if (rtti == RTTI_VESSEL) {
			secondaryCurrent = (int)tech->Turret_Facing();
			secondaryDesired = -1;
			isTurretEquipped = ((VesselClass*)obj)->Class->IsTurretEquipped;
		} else if (rtti == RTTI_AIRCRAFT) {
			secondaryCurrent = (int)((AircraftClass*)obj)->SecondaryFacing.Current();
			secondaryDesired = (int)((AircraftClass*)obj)->SecondaryFacing.Desired();
		}
					buf_cat(",\"mt\":%d,\"status\":%d,\"arm\":%d,\"drv\":%s,\"rot\":%s,\"mq\":%d,\"pth\":%d,\"try\":%d,\"init\":%s,\"recruit\":%s,\"p0\":%d,\"p1\":%d,\"p2\":%d,\"p3\":%d,\"p4\":%d,\"p5\":%d,\"p6\":%d,\"p7\":%d,\"p8\":%d,\"p9\":%d,\"p10\":%d,\"p11\":%d,\"p12\":%d,\"p13\":%d,\"p14\":%d,\"p15\":%d,\"spd\":%d,\"pf\":%d,\"pfd\":%d,\"sf\":%d,\"sfd\":%d,\"tur\":%s,\"ms\":%d,\"gsb\":%d,\"sb\":%d,\"fm\":%s,\"fsp\":%d,\"fms\":%d,\"mx\":%d,\"add\":%d,\"plw\":%d,\"adsc\":%d",
						foot->Get_Mission_Timer_Value(), (int)foot->Status, (int)foot->Arm.Value(),
						foot->IsDriving ? "true" : "false",
						foot->IsRotating ? "true" : "false",
						(int)foot->MissionQueue,
						(int)foot->PathThreshhold,
						(int)foot->TryTryAgain,
					foot->IsInitiated ? "true" : "false",
					foot->Is_Recruitable(foot->House) ? "true" : "false",
				(int)foot->Path[0],
			(int)foot->Path[1],
				(int)foot->Path[2],
				(int)foot->Path[3],
				(int)foot->Path[4],
					(int)foot->Path[5],
					(int)foot->Path[6],
					(int)foot->Path[7],
					(int)foot->Path[8],
					(int)foot->Path[9],
					(int)foot->Path[10],
					(int)foot->Path[11],
					(int)foot->Path[12],
					(int)foot->Path[13],
					(int)foot->Path[14],
					(int)foot->Path[15],
						(int)foot->Speed,
						(int)tech->PrimaryFacing.Current(),
						(int)tech->PrimaryFacing.Desired(),
						secondaryCurrent,
						secondaryDesired,
						isTurretEquipped ? "true" : "false",
						(int)tech->Techno_Type_Class()->MaxSpeed,
					(int)(foot->House->GroundspeedBias * 256),
					(int)(foot->SpeedBias * 256),
					foot->IsFormationMove ? "true" : "false",
					(int)foot->FormationSpeed,
					(int)foot->FormationMaxSpeed,
					agentMaxSpeed,
					agentSpeedAdd,
					PIXEL_LEPTON_W,
					assignDestStopClear);
				if (rtti == RTTI_UNIT || rtti == RTTI_VESSEL) {
					DriveClass* drive = (DriveClass*)obj;
					buf_cat(",\"tn\":%d,\"ti\":%d,\"sa\":%d,\"wspd\":%d,\"wmx\":%d,\"wact\":%d,\"wend\":%d,\"wsteps\":%d",
					drive->Agent_Track_Number(),
					drive->Agent_Track_Index(),
					drive->Agent_Speed_Accum(),
					drive->Agent_Last_Move_Speed(),
					drive->Agent_Last_Max_Speed(),
					drive->Agent_Last_Actual_Start(),
					drive->Agent_Last_Actual_End(),
					drive->Agent_Last_Steps());
					if (rtti == RTTI_VESSEL) {
						VesselClass* vessel = (VesselClass*)obj;
						buf_cat(",\"pulse\":%d", (int)vessel->PulseCountDown.Value());
					} else if (rtti == RTTI_UNIT) {
						UnitClass* unit = (UnitClass*)obj;
						buf_cat(",\"tib\":%d,\"gold\":%d,\"gems\":%d,\"ustatus\":%d",
							unit->Tiberium, unit->Gold, unit->Gems, (int)unit->Status);
					}
				}
		// Task #43 diagnostic: expose IdleTimer + Doing + IsFiring for infantry
		// to compare with TS's isReadyToRandomAnimate gate.
		if (rtti == RTTI_INFANTRY) {
			InfantryClass* inf = (InfantryClass*)obj;
				buf_cat(",\"idle\":%d,\"doing\":%d,\"stage\":%d,\"firing\":%s,\"prone\":%s,\"fear\":%d,\"hgt\":%d",
					(int)inf->IdleTimer.Value(),
					(int)inf->Doing,
					(int)inf->Fetch_Stage(),
					inf->IsFiring ? "true" : "false",
					inf->IsProne ? "true" : "false",
					(int)inf->Fear,
					(int)inf->Height);
		} else if (rtti == RTTI_AIRCRAFT) {
			AircraftClass* air = (AircraftClass*)obj;
			buf_cat(",\"hgt\":%d,\"landing\":%s,\"takingOff\":%s",
				air->Agent_Height(),
				air->Agent_Is_Landing() ? "true" : "false",
				air->Agent_Is_Taking_Off() ? "true" : "false");
		}
	}

	if (tech->Techno_Type_Class()->Max_Passengers() > 0) {
		buf_cat(",\"cargo\":%d,\"tether\":%s", tech->How_Many(), tech->IsTethered ? "true" : "false");
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
char* agent_get_bullet_scatter_log(void)
{
	buf_init(s_state_buf, STATE_BUF_SIZE);
	buf_cat("{\"tick\":%ld,\"scatter\":[", Frame);
	bool first = true;
	int start = g_debug_bullet_scatter_idx - g_debug_bullet_scatter_count;
	for (int i = 0; i < g_debug_bullet_scatter_count; i++) {
		auto &e = g_debug_bullet_scatters[(start + i) % 64];
		if (!first) buf_cat(",");
		first = false;
		buf_cat("{\"frame\":%d,\"bid\":%d,\"bt\":%d,\"wh\":%d,\"pb\":%d,\"max\":%d,"
			"\"cx\":%d,\"cy\":%d,\"tx\":%d,\"ty\":%d,\"pbx\":%d,\"pby\":%d}",
			e.frame, e.bulletId, e.bulletType, e.warhead, e.paybackRtti, e.maxSpeed,
			e.coordX, e.coordY, e.targetX, e.targetY, e.paybackX, e.paybackY);
	}

	buf_cat("]}");
	return s_state_buf;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int agent_tick_only(int n)
{
	if (n < 1) n = 1;
	if (n > 1000) n = 1000;
	g_autoplay_mode = 1;
	int done = 0;
	for (int i = 0; i < n; i++) {
		done = do_tick();
		if (done) break;
	}
	return done;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* agent_get_scg06_nearby_infantry(void)
{
	buf_init(s_state_buf, STATE_BUF_SIZE);
	buf_cat("{\"tick\":%ld,\"inf\":[", Frame);
	bool first = true;
	for (int ii = 0; ii < Infantry.Count(); ii++) {
		InfantryClass* inf = Infantry.Ptr(ii);
		if (!inf || !inf->IsActive) continue;
		CELL cell = Coord_Cell(inf->Center_Coord());
		int cx = Cell_X(cell);
		int cy = Cell_Y(cell);
		if (cx < 16 || cx > 24 || cy < 62 || cy > 70) continue;
		if (!first) buf_cat(",");
		first = false;
		FootClass* foot = (FootClass*)inf;
		COORDINATE coord = inf->Center_Coord();
		COORDINATE tcoord = Target_Legal(foot->TarCom) ? As_Coord(foot->TarCom) : 0;
		COORDINATE ncoord = Target_Legal(foot->NavCom) ? As_Coord(foot->NavCom) : 0;
		buf_cat("{\"id\":%d,\"t\":\"%s\",\"house\":\"%s\",\"cx\":%d,\"cy\":%d,"
			"\"lx\":%d,\"ly\":%d,\"m\":%d,\"mt\":%d,\"mq\":%d,\"arm\":%d,"
			"\"drv\":%s,\"doing\":%d,\"stage\":%d,\"firing\":%s,"
			"\"tlx\":%d,\"tly\":%d,\"nlx\":%d,\"nly\":%d}",
			AGENT_ID(RTTI_INFANTRY, ii), inf->Class_Of().Name(), agent_house_name(inf->Owner()),
			cx, cy, (int)Coord_X(coord), (int)Coord_Y(coord),
			(int)inf->Get_Mission(), foot->Get_Mission_Timer_Value(), (int)foot->MissionQueue,
			(int)foot->Arm.Value(), foot->IsDriving ? "true" : "false",
			(int)inf->Doing, (int)inf->Fetch_Stage(), inf->IsFiring ? "true" : "false",
			(int)Coord_X(tcoord), (int)Coord_Y(tcoord), (int)Coord_X(ncoord), (int)Coord_Y(ncoord));
	}
	buf_cat("]}");
	return s_state_buf;
}

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
	extern bool g_rng_tracking;
	extern bool g_rng_log_enabled;
	extern unsigned long g_rng_seed_log[];
	extern int g_rng_source_log[];
	extern int g_rng_log_count;
	extern int g_nav_clear_site_id;
	extern int g_cover_coord_move_target_x;
	extern int g_cover_coord_move_target_y;
	extern int g_cover_coord_move_mission_target_x;
	extern int g_cover_coord_move_mission_target_y;
	// Enable tracking + logging on first state read
	if (!g_rng_tracking) { g_rng_tracking = true; g_rng_log_enabled = true; }
	buf_cat("{\"tick\":%ld,\"credits\":%ld,\"playerHouse\":\"%s\",\"rngState\":%lu,\"rngCalls\":%lu,\"navClearSite\":%d,\"coverMoveTargetX\":%d,\"coverMoveTargetY\":%d,\"coverMoveMissionTargetX\":%d,\"coverMoveMissionTargetY\":%d,\"tibScan\":%d,\"tibGrowCount\":%d,\"tibGrowExcess\":%d,\"tibSpreadCount\":%d,\"tibSpreadExcess\":%d,\"rngLog\":[",
		Frame,
		(long)(PlayerPtr->Credits + PlayerPtr->Tiberium),
		agent_house_name(player_house),
		Scen.RandomNumber.Seed,
		g_rng_call_count,
		g_nav_clear_site_id,
		g_cover_coord_move_target_x,
		g_cover_coord_move_target_y,
		g_cover_coord_move_mission_target_x,
		g_cover_coord_move_mission_target_y,
		(int)Map.Agent_Tiberium_Scan(),
		Map.Agent_Tiberium_Growth_Count(),
		Map.Agent_Tiberium_Growth_Excess(),
		Map.Agent_Tiberium_Spread_Count(),
		Map.Agent_Tiberium_Spread_Excess());
	// Dump all seed+source+entity triples from the per-tick log (up to buffer size)
	// Entity tag identifies WHICH entity a call belongs to, regardless of granular
	// source tag override (e.g., 30001, 60043). Task #43+ diagnostic infrastructure.
	extern int g_rng_entity_log[];
	for (int li = 0; li < g_rng_log_count && li < 1024; li++) {
		if (li > 0) buf_cat(",");
		buf_cat("[%lu,%d,%d]", g_rng_seed_log[li], g_rng_source_log[li], g_rng_entity_log[li]);
	}
	buf_cat("],");
		// Reset log for next step (keep logging enabled)
		g_rng_log_count = 0;

		buf_cat("\"tibCells\":[");
			for (int ci = 2748; ci <= 2885; ci++) {
				if (ci > 2748) buf_cat(",");
			CellClass const &cell = Map[(CELL)ci];
			buf_cat("{\"i\":%d,\"ov\":%d,\"data\":%d,\"land\":%d}",
				ci, (int)cell.Overlay, (int)cell.OverlayData, (int)cell.Land_Type());
		}
			buf_cat("],");

			buf_cat("\"overlayReadWindow\":[");
			for (int oi = 0; oi < 21; oi++) {
				if (oi > 0) buf_cat(",");
				buf_cat("%d", g_agent_overlay_read_window[oi]);
			}
			buf_cat("],");

			buf_cat("\"smudges\":[");
			{
				bool sfirst = true;
				for (CELL si = 0; si < MAP_CELL_TOTAL; si++) {
					CellClass const & cell = Map[si];
					if (cell.Smudge == SMUDGE_NONE) continue;
					if (!sfirst) buf_cat(",");
					sfirst = false;
					SmudgeTypeClass const & stype = SmudgeTypeClass::As_Reference(cell.Smudge);
					buf_cat("{\"i\":%d,\"type\":\"%s\",\"cx\":%d,\"cy\":%d,\"data\":%d,\"land\":%d}",
						(int)si, stype.IniName, Cell_X(si), Cell_Y(si),
						(int)cell.SmudgeData, (int)cell.Land_Type());
				}
			}
			buf_cat("],");

			// Dump Logic layer entity order (units/infantry/aircraft/buildings/vessels) for parity debugging.
	// Buildings/vessels included so cross-engine structure iteration order can be verified
	// (BuildingClass::Unlimbo insertion vs TS INI section order — SCG11EA t32 SAM, task ad83df56).
	// TERRAIN/ANIM/BULLET are skipped to keep the dump compact (SCG03EA has 84 TERRAIN entries
	// which otherwise push the state buffer past 128KB and crash the ccall with OOB).
	buf_cat("\"logicLayer\":[");
	{
		bool lfirst = true;
		for (int li = 0; li < Logic.Count(); li++) {
			ObjectClass * lobj = Logic[li];
			if (!lobj || !lobj->IsActive) continue;
			RTTIType rtti = lobj->What_Am_I();
			if (rtti != RTTI_UNIT && rtti != RTTI_INFANTRY && rtti != RTTI_AIRCRAFT
				&& rtti != RTTI_BUILDING && rtti != RTTI_VESSEL) continue;
			const char * tname = "?";
			const char * hname = "?";
			if (rtti == RTTI_UNIT) {
				UnitClass * u = (UnitClass *)lobj;
				if (u->Class) tname = u->Class->IniName;
				if (u->House && u->House->Class) hname = agent_house_name(u->House->Class->House);
			} else if (rtti == RTTI_INFANTRY) {
				InfantryClass * inf = (InfantryClass *)lobj;
				if (inf->Class) tname = inf->Class->IniName;
				if (inf->House && inf->House->Class) hname = agent_house_name(inf->House->Class->House);
			} else if (rtti == RTTI_AIRCRAFT) {
				AircraftClass * a = (AircraftClass *)lobj;
				if (a->Class) tname = a->Class->IniName;
				if (a->House && a->House->Class) hname = agent_house_name(a->House->Class->House);
			} else if (rtti == RTTI_BUILDING) {
				BuildingClass * b = (BuildingClass *)lobj;
				if (b->Class) tname = b->Class->IniName;
				if (b->House && b->House->Class) hname = agent_house_name(b->House->Class->House);
			} else if (rtti == RTTI_VESSEL) {
				VesselClass * v = (VesselClass *)lobj;
				if (v->Class) tname = v->Class->IniName;
				if (v->House && v->House->Class) hname = agent_house_name(v->House->Class->House);
			}
			if (!lfirst) buf_cat(",");
			lfirst = false;
			int lcx = -1, lcy = -1;
			{
				TechnoClass * tt = (TechnoClass *)lobj;
				COORDINATE cc = tt->Coord;
				lcx = Coord_XCell(cc);
				lcy = Coord_YCell(cc);
			}
			// RTTI one-letter tag: U=unit, I=infantry, A=aircraft, B=building, V=vessel
			char rtag = 'U';
			if (rtti == RTTI_INFANTRY) rtag = 'I';
			else if (rtti == RTTI_AIRCRAFT) rtag = 'A';
			else if (rtti == RTTI_BUILDING) rtag = 'B';
			else if (rtti == RTTI_VESSEL) rtag = 'V';
			int obj_index = agent_object_index(lobj, rtti);
			int aid = obj_index >= 0 ? AGENT_ID(rtti, obj_index) : -1;
			int mission = -1;
			int mission_timer = -1;
			int mission_queue = -1;
			int lx = -1, ly = -1;
			int hp = -1, mhp = -1, cloak = -1, cstage = -1, crate = -1, cdelay = -1;
			int arm = -1, pulse = -1;
			int primary_current = -1, primary_desired = -1;
				int tarx = 0, tary = 0;
				int tar_kind = -1, tar_value = -1, tar_rtti = -1, tar_obj_index = -1;
				int firex = 0, firey = 0, in_range0 = -1, can_fire0 = -1;
			bool ready_cloak = false;
			bool is_driving = false;
			int doing = -1;
			int height = -1;
			bool is_landing = false;
			bool is_taking_off = false;
			{
				TechnoClass * tt = (TechnoClass *)lobj;
				COORDINATE cc = tt->Coord;
				lx = (int)Coord_X(cc);
				ly = (int)Coord_Y(cc);
				mission = (int)tt->Get_Mission();
				hp = (int)tt->Strength;
				mhp = (int)tt->Class_Of().MaxStrength;
				cloak = (int)tt->Cloak;
				cstage = tt->CloakingDevice.Fetch_Stage();
				crate = tt->CloakingDevice.Fetch_Rate();
				cdelay = (int)tt->CloakDelay.Value();
				arm = (int)tt->Arm.Value();
				ready_cloak = tt->Is_Ready_To_Cloak();
					if (Target_Legal(tt->TarCom)) {
						COORDINATE tc = As_Coord(tt->TarCom);
						tarx = (int)Coord_X(tc);
						tary = (int)Coord_Y(tc);
						tar_kind = (int)Target_Kind(tt->TarCom);
						tar_value = (int)Target_Value(tt->TarCom);
						ObjectClass * tobj = As_Object(tt->TarCom);
						if (tobj) {
							tar_rtti = (int)tobj->What_Am_I();
							tar_obj_index = agent_object_index(tobj, tobj->What_Am_I());
						}
						COORDINATE fc = tt->Fire_Coord(0);
						firex = (int)Coord_X(fc);
						firey = (int)Coord_Y(fc);
						in_range0 = tt->In_Range(tt->TarCom, 0) ? 1 : 0;
						can_fire0 = (int)tt->Can_Fire(tt->TarCom, 0);
					}
					primary_current = (int)tt->PrimaryFacing.Current();
					primary_desired = (int)tt->PrimaryFacing.Desired();
				}
			if (rtti == RTTI_UNIT || rtti == RTTI_INFANTRY || rtti == RTTI_AIRCRAFT || rtti == RTTI_VESSEL) {
				FootClass * foot = (FootClass *)lobj;
				mission_timer = foot->Get_Mission_Timer_Value();
				mission_queue = (int)foot->MissionQueue;
				is_driving = foot->IsDriving;
				if (rtti == RTTI_INFANTRY) {
					doing = (int)((InfantryClass *)lobj)->Doing;
				} else if (rtti == RTTI_VESSEL) {
					pulse = (int)((VesselClass *)lobj)->PulseCountDown.Value();
				} else if (rtti == RTTI_AIRCRAFT) {
					AircraftClass * air = (AircraftClass *)lobj;
					height = air->Agent_Height();
					is_landing = air->Agent_Is_Landing();
					is_taking_off = air->Agent_Is_Taking_Off();
				}
			} else if (rtti == RTTI_BUILDING) {
				BuildingClass * b = (BuildingClass *)lobj;
				mission_timer = b->Get_Mission_Timer_Value();
			}
					buf_cat("[%d,\"%s\",\"%s\",%d,%d,\"%c\",%d,%d,%d,%d,%s,%d,%d,%d,%d,%d,%d,%d,%d,%d,%s,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%s,%s]",
						li, tname, hname, lcx, lcy, rtag,
						aid, mission, mission_timer, mission_queue, is_driving ? "true" : "false",
						doing, lx, ly, hp, mhp, cloak, cstage, crate, cdelay,
						ready_cloak ? "true" : "false", tarx, tary, arm, pulse,
						(int)((TechnoClass *)lobj)->Mission,
						(int)((TechnoClass *)lobj)->MissionQueue,
						(int)((TechnoClass *)lobj)->Status,
						primary_current, primary_desired,
						tar_kind, tar_value, tar_rtti, tar_obj_index,
						firex, firey, in_range0, can_fire0,
						height, is_landing ? "true" : "false", is_taking_off ? "true" : "false");
		}
	}
	buf_cat("],");

	buf_cat("\"tarcomLog\":[");
	{
		bool tfirst = true;
		int count = g_agent_tarcom_count < 128 ? g_agent_tarcom_count : 128;
		int start = g_agent_tarcom_count - count;
		for (int i = 0; i < count; i++) {
			int slot = (start + i) % 128;
			if (!tfirst) buf_cat(",");
			tfirst = false;
			buf_cat("{\"frame\":%d,\"tag\":%d,\"stype\":%d,\"cell\":\"(%d,%d)\","
				"\"mission\":%d,\"prevKind\":%d,\"prevValue\":%d,"
				"\"newKind\":%d,\"newValue\":%d,\"trtti\":%d,\"ttype\":%d,"
				"\"tcell\":\"(%d,%d)\",\"fire\":\"(%d,%d)\",\"inRange0\":%d}",
				g_agent_tarcom_frame[slot], g_agent_tarcom_tag_log[slot],
				g_agent_tarcom_self_type[slot], g_agent_tarcom_self_x[slot], g_agent_tarcom_self_y[slot],
				g_agent_tarcom_mission[slot],
				g_agent_tarcom_prev_kind[slot], g_agent_tarcom_prev_value[slot],
				g_agent_tarcom_new_kind[slot], g_agent_tarcom_new_value[slot],
				g_agent_tarcom_target_rtti[slot], g_agent_tarcom_target_type[slot],
				g_agent_tarcom_target_x[slot], g_agent_tarcom_target_y[slot],
				g_agent_tarcom_fire_x[slot], g_agent_tarcom_fire_y[slot],
				g_agent_tarcom_in_range0[slot]);
		}
	}
	buf_cat("],");

	buf_cat("\"anims\":[");
	{
		bool afirst = true;
		for (int ai = 0; ai < Anims.Count(); ai++) {
			AnimClass * a = Anims.Ptr(ai);
			if (!a || !a->IsActive) continue;
			int logic_index = -1;
			for (int li = 0; li < Logic.Count(); li++) {
				if (Logic[li] == a) {
					logic_index = li;
					break;
				}
			}
			AnimType atype = (AnimType)(*a);
			AnimTypeClass const & aclass = (AnimTypeClass const &)a->Class_Of();
			COORDINATE ac = a->Center_Coord();
			if (!afirst) buf_cat(",");
			afirst = false;
			buf_cat("{\"i\":%d,\"logicIndex\":%d,\"id\":%d,\"name\":\"%s\",\"type\":%d,"
				"\"cx\":%d,\"cy\":%d,\"lx\":%d,\"ly\":%d,"
				"\"stage\":%d,\"rate\":%d,\"about\":%s,"
				"\"biggest\":%d,\"stages\":%d,\"loopStart\":%d,\"loopEnd\":%d,\"loops\":%d}",
				ai, logic_index, AGENT_ID(RTTI_ANIM, ai), Anim_Name(atype), (int)atype,
				Coord_XCell(ac), Coord_YCell(ac), Coord_X(ac), Coord_Y(ac),
				a->Fetch_Stage(), a->Fetch_Rate(), a->About_To_Change() ? "true" : "false",
				aclass.Biggest, aclass.Stages, aclass.LoopStart, aclass.LoopEnd, (int)a->Loops);
		}
	}
		buf_cat("],");

		buf_cat("\"bulletScatterLog\":[");
		{
			bool first = true;
			int start = g_debug_bullet_scatter_idx - g_debug_bullet_scatter_count;
			for (int i = 0; i < g_debug_bullet_scatter_count; i++) {
				auto &e = g_debug_bullet_scatters[(start + i) % 64];
				if (!first) buf_cat(",");
				first = false;
					buf_cat("{\"frame\":%d,\"bid\":%d,\"bt\":%d,\"wh\":%d,\"pb\":%d,\"max\":%d,"
						"\"cx\":%d,\"cy\":%d,\"tx\":%d,\"ty\":%d,\"pbx\":%d,\"pby\":%d}",
						e.frame, e.bulletId, e.bulletType, e.warhead, e.paybackRtti, e.maxSpeed,
						e.coordX, e.coordY, e.targetX, e.targetY, e.paybackX, e.paybackY);
			}
		}
		buf_cat("],");

		buf_cat("\"bullets\":[");
	{
		bool bfirst = true;
		for (int bi = 0; bi < Bullets.Count(); bi++) {
			BulletClass * b = Bullets.Ptr(bi);
			if (!b || !b->IsActive) continue;
			if (!bfirst) buf_cat(",");
			bfirst = false;
			COORDINATE bc = b->Coord;
			COORDINATE ft = b->Fuse_Target();
			TARGET bt = b->Agent_Target();
			COORDINATE tc = Target_Legal(bt) ? As_Coord(bt) : 0;
			TechnoClass * payback = b->Agent_Payback();
			int payback_id = -1;
			if (payback) {
				payback_id = agent_object_index(payback, payback->What_Am_I());
				if (payback_id >= 0) payback_id = AGENT_ID(payback->What_Am_I(), payback_id);
			}
			buf_cat("{\"i\":%d,\"type\":\"%s\",\"cx\":%d,\"cy\":%d,\"lx\":%d,\"ly\":%d,"
				"\"tx\":%d,\"ty\":%d,\"fx\":%d,\"fy\":%d,\"str\":%d,\"wh\":%d,"
				"\"timer\":%d,\"max\":%d,\"pb\":%d,\"down\":%s,\"limbo\":%s}",
				bi,
				b->Class ? b->Class->IniName : "?",
				Coord_XCell(bc), Coord_YCell(bc), Coord_X(bc), Coord_Y(bc),
				Coord_X(tc), Coord_Y(tc), Coord_X(ft), Coord_Y(ft),
				(int)b->Strength, b->Agent_Warhead(), (int)b->Timer, b->Agent_Max_Speed(),
				payback_id, b->IsDown ? "true" : "false", b->IsInLimbo ? "true" : "false");
		}
	}
	buf_cat("],");

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

	buf_cat("\"weapons\":[");
	first = true;
	for (int windex = 0; windex < WEAPON_COUNT; windex++) {
		if (windex >= Weapons.Length()) break;
		WeaponTypeClass* weapon = Weapons.Raw_Ptr(windex);
		if (!weapon) continue;
		if (!first) buf_cat(",");
		first = false;
		buf_cat("{\"id\":%d,\"name\":\"%s\",\"sup\":%s}",
			weapon->ID,
			weapon->Name(),
			weapon->IsSupressed ? "true" : "false");
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

		buf_cat("{\"id\":%d,\"t\":\"%s\",\"house\":\"%s\",\"cx\":%d,\"cy\":%d,\"hp\":%d,\"mhp\":%d,\"ally\":%s,\"repairing\":%s",
			AGENT_ID(RTTI_BUILDING, i),
			b->Class_Of().Name(),
			agent_house_name(house),
			Cell_X(cell), Cell_Y(cell),
			(int)b->Strength,
			(int)b->Class_Of().MaxStrength,
			ally ? "true" : "false",
			b->IsRepairing ? "true" : "false");
		if (b->Factory) {
			FactoryClass* factory = b->Factory;
			const char* prod_name = agent_factory_item_name(factory, b->Class->ToBuild);
			buf_cat(",\"factory\":{\"t\":\"%s\",\"prog\":%d,\"done\":%s,\"building\":%s,\"rtti\":%d}",
				prod_name ? prod_name : "?",
				factory->Completion(),
				factory->Has_Completed() ? "true" : "false",
				factory->Is_Building() ? "true" : "false",
				(int)b->Class->ToBuild);
		}
		buf_cat(",\"placementDelay\":%d}", (int)b->PlacementDelay.Value());
	}
	buf_cat("],");

	/* --- House AI / production state (oracle instrumentation) --- */
	buf_cat("\"houses\":[");
	first = true;
	for (int hi = 0; hi < Houses.Count(); hi++) {
		HouseClass* h = Houses.Ptr(hi);
		if (!h || !h->Class) continue;
		if (!first) buf_cat(",");
		first = false;
		const char* build_inf = NULL;
		const char* build_unit = NULL;
		const char* build_vessel = NULL;
		const char* build_aircraft = NULL;
		if (h->BuildUnit != UNIT_NONE) {
			build_unit = UnitTypeClass::As_Reference(h->BuildUnit).Name();
		}
		if (h->BuildInfantry != INFANTRY_NONE) {
			build_inf = InfantryTypeClass::As_Reference(h->BuildInfantry).Name();
		}
		if (h->BuildVessel != VESSEL_NONE) {
			build_vessel = VesselTypeClass::As_Reference(h->BuildVessel).Name();
		}
		if (h->BuildAircraft != AIRCRAFT_NONE) {
			build_aircraft = AircraftTypeClass::As_Reference(h->BuildAircraft).Name();
		}
		buf_cat("{\"i\":%d,\"house\":\"%s\",\"actLike\":\"%s\",\"human\":%s,\"playerControl\":%s,"
			"\"state\":%d,\"latime\":%d,\"laenemy\":\"%s\","
			"\"techLevel\":%d,\"bscan\":%lu,\"activeBScan\":%lu,\"oldBScan\":%lu,"
			"\"iscan\":%lu,\"aiscan\":%lu,"
			"\"buildUnit\":%d,\"buildUnitName\":\"%s\","
			"\"buildInf\":%d,\"buildInfName\":\"%s\",\"curInf\":%u,\"maxInf\":%u,"
			"\"buildVessel\":%d,\"buildVesselName\":\"%s\",\"curVessel\":%u,\"maxVessel\":%u,"
			"\"buildAircraft\":%d,\"buildAircraftName\":\"%s\",\"curAircraft\":%u,\"maxAircraft\":%u,"
			"\"started\":%s,\"base\":%s,\"alerted\":%s,\"iq\":%d,\"money\":%d,\"infFac\":%d}",
			hi,
			agent_house_name(h->Class->House),
			agent_house_name(h->ActLike),
			h->IsHuman ? "true" : "false",
			h->IsPlayerControl ? "true" : "false",
			(int)h->State,
			(int)h->LATime,
			agent_house_name(h->LAEnemy),
			(int)h->Control.TechLevel,
			(unsigned long)h->BScan,
			(unsigned long)h->ActiveBScan,
			(unsigned long)h->OldBScan,
			(unsigned long)h->IScan,
			(unsigned long)h->ActiveIScan,
			(int)h->BuildUnit,
			build_unit ? build_unit : "",
			(int)h->BuildInfantry,
			build_inf ? build_inf : "",
			h->CurInfantry,
			h->Control.MaxInfantry,
			(int)h->BuildVessel,
			build_vessel ? build_vessel : "",
			h->CurVessels,
			h->Control.MaxVessel,
			(int)h->BuildAircraft,
			build_aircraft ? build_aircraft : "",
			h->CurAircraft,
			h->Control.MaxAircraft,
			h->IsStarted ? "true" : "false",
			h->IsBaseBuilding ? "true" : "false",
			h->IsAlerted ? "true" : "false",
			(int)h->IQ,
			(int)h->Available_Money(),
			(int)h->InfantryFactories);
	}
	buf_cat("],");

	/* --- Raw infantry pool, including limbo/dead, for HouseClass::IScan parity. --- */
	buf_cat("\"infantryPool\":[");
	first = true;
	for (int ii = 0; ii < Infantry.Count(); ii++) {
		InfantryClass* inf = Infantry.Ptr(ii);
		if (!inf) continue;
		if (!first) buf_cat(",");
		first = false;
		CELL icell = Coord_Cell(inf->Center_Coord());
		FootClass* foot = (FootClass*)inf;
		buf_cat("{\"id\":%d,\"t\":\"%s\",\"house\":\"%s\",\"cx\":%d,\"cy\":%d,"
			"\"hp\":%d,\"limbo\":%s,\"locked\":%s,\"active\":%s,\"m\":%d,\"mt\":%d,\"mq\":%d,\"doing\":%d}",
			AGENT_ID(RTTI_INFANTRY, ii),
			inf->Class_Of().Name(),
			agent_house_name(inf->Owner()),
			Cell_X(icell), Cell_Y(icell),
			(int)inf->Strength,
			inf->IsInLimbo ? "true" : "false",
			inf->IsLocked ? "true" : "false",
			inf->IsActive ? "true" : "false",
			(int)inf->Get_Mission(),
			foot->Get_Mission_Timer_Value(),
			(int)foot->MissionQueue,
			(int)inf->Doing);
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

	// Append debug movement log
		buf_cat("],\"debugMoves\":[");
		for (int mi = 0; mi < g_debug_move_count && mi < 256; mi++) {
			int ri = (g_debug_move_idx - g_debug_move_count + mi + 256) % 256;
			auto &dm = g_debug_moves[ri];
			if (mi > 0) buf_cat(",");
			buf_cat("[%d,%d,%d,%d,%d,%d,%d,%d]", dm.preLX, dm.preLY, dm.postLX, dm.postLY, dm.dir, dm.dist, dm.headLX, dm.headLY);
		}

		buf_cat("],\"teamRemoveLog\":[");
		for (int tri = 0; tri < g_debug_team_remove_count && tri < 128; tri++) {
			int ri = (g_debug_team_remove_idx - g_debug_team_remove_count + tri + 128) % 128;
			auto &tr = g_debug_team_removes[ri];
			if (tri > 0) buf_cat(",");
			buf_cat("{\"frame\":%d,\"team\":%d,\"rtti\":%d,\"idx\":%d,"
				"\"site\":%d,\"total\":%d,\"cur\":%d,\"cx\":%d,\"cy\":%d}",
				tr.frame, tr.teamIndex, tr.rtti, tr.index,
				tr.site, tr.totalBefore, tr.currentMission, tr.cellX, tr.cellY);
		}

		/* --- Teams (for TS parity debugging) --- */
		buf_cat("],\"teams\":[");
	{
		bool tfirst = true;
		for (int ti = 0; ti < Teams.Count(); ti++) {
			TeamClass* t = Teams.Ptr(ti);
			if (!t || !t->IsActive) continue;
			if (!tfirst) buf_cat(",");
			tfirst = false;
			int desired = 0;
			for (int k = 0; k < t->Class->ClassCount; k++) {
				desired += t->Class->Members[k].Quantity;
			}
			// Phase 7B+ probe extension — expose mission state for TS parity:
			// currentMission (private, accessor added), Target/MissionTarget coords,
			// mission list contents, and timeout. SCG13EA t101 root-cause requires
			// knowing whether team has advanced missions.
			int cur_mission = t->Get_Current_Mission();
			int time_out = t->Get_Time_Out();
			COORDINATE tgt_coord = Target_Legal(t->Target) ? As_Coord(t->Target) : 0;
			COORDINATE mtgt_coord = Target_Legal(t->MissionTarget) ? As_Coord(t->MissionTarget) : 0;
			COORDINATE zone_coord = Target_Legal(t->Zone) ? As_Coord(t->Zone) : 0;
			COORDINATE close_coord = Target_Legal(t->ClosestMember) ? As_Coord(t->ClosestMember) : 0;

			buf_cat("{\"i\":%d,\"cls\":\"%s\",\"house\":\"%s\",\"total\":%d,\"desired\":%d,\"fs\":%s,\"us\":%s,\"fa\":%s,\"mv\":%s,\"hb\":%s,\"rf\":%s,\"alt\":%s,\"next\":%s,\"lag\":%s,\"cur\":%d,\"to\":%d,\"tgtX\":%d,\"tgtY\":%d,\"mtgtX\":%d,\"mtgtY\":%d,\"zoneX\":%d,\"zoneY\":%d,\"closeX\":%d,\"closeY\":%d,\"missions\":[",
				ti,
				t->Class->IniName,
				agent_house_name(t->House->Class->House),
				t->Total, desired,
				t->IsFullStrength ? "true" : "false",
				t->IsUnderStrength ? "true" : "false",
				t->IsForcedActive ? "true" : "false",
				t->IsMoving ? "true" : "false",
				t->IsHasBeen ? "true" : "false",
				t->IsReforming ? "true" : "false",
				t->IsAltered ? "true" : "false",
				t->IsNextMission ? "true" : "false",
				t->IsLagging ? "true" : "false",
				cur_mission, time_out,
				(int)Coord_X(tgt_coord), (int)Coord_Y(tgt_coord),
				(int)Coord_X(mtgt_coord), (int)Coord_Y(mtgt_coord),
				(int)Coord_X(zone_coord), (int)Coord_Y(zone_coord),
				(int)Coord_X(close_coord), (int)Coord_Y(close_coord));
			// Mission list dump (TeamMissionType enum + argument)
			for (int mi = 0; mi < t->Class->MissionCount; mi++) {
				if (mi > 0) buf_cat(",");
				buf_cat("[%d,%ld]",
					(int)t->Class->MissionList[mi].Mission,
					(long)t->Class->MissionList[mi].Data.Value);
			}
			buf_cat("],\"members\":[");
			// Dump per-typeindex quantity + member IDs (from Infantry/Units arrays whose Team == t)
			bool mfirst = true;
			for (int k = 0; k < t->Class->ClassCount; k++) {
				if (!mfirst) buf_cat(",");
				mfirst = false;
				int have = 0;
				TechnoTypeClass const * wantType = t->Class->Members[k].Class;
				char memberIds[256] = "";
				int midLen = 0;
				if (wantType) {
					for (int ii = 0; ii < Infantry.Count(); ii++) {
						InfantryClass * inf = Infantry.Ptr(ii);
						if (inf && inf->IsActive && inf->Team == t && &inf->Class_Of() == wantType) {
							have++;
							midLen += snprintf(memberIds + midLen, sizeof(memberIds) - midLen, "%s%d", midLen > 0 ? "," : "", AGENT_ID(RTTI_INFANTRY, ii));
						}
					}
					for (int ui = 0; ui < Units.Count(); ui++) {
						UnitClass * u = Units.Ptr(ui);
						if (u && u->IsActive && u->Team == t && &u->Class_Of() == wantType) {
							have++;
							midLen += snprintf(memberIds + midLen, sizeof(memberIds) - midLen, "%s%d", midLen > 0 ? "," : "", AGENT_ID(RTTI_UNIT, ui));
						}
					}
					for (int ai = 0; ai < Aircraft.Count(); ai++) {
						AircraftClass * a = Aircraft.Ptr(ai);
						if (a && a->IsActive && a->Team == t && &a->Class_Of() == wantType) {
							have++;
							midLen += snprintf(memberIds + midLen, sizeof(memberIds) - midLen, "%s%d", midLen > 0 ? "," : "", AGENT_ID(RTTI_AIRCRAFT, ai));
						}
					}
					for (int vi = 0; vi < Vessels.Count(); vi++) {
						VesselClass * v = Vessels.Ptr(vi);
						if (v && v->IsActive && v->Team == t && &v->Class_Of() == wantType) {
							have++;
							midLen += snprintf(memberIds + midLen, sizeof(memberIds) - midLen, "%s%d", midLen > 0 ? "," : "", AGENT_ID(RTTI_VESSEL, vi));
						}
					}
				}
				buf_cat("{\"type\":\"%s\",\"want\":%d,\"have\":%d,\"ids\":[%s]}",
					wantType ? wantType->IniName : "?",
					t->Class->Members[k].Quantity,
					have,
					memberIds);
			}
			buf_cat("]}");
		}
	}

	/* --- TeamTypes (static scenario parse, for AI production parity) --- */
	buf_cat("],\"teamTypes\":[");
	{
		bool ttfirst = true;
		for (int tti = 0; tti < TeamTypes.Count(); tti++) {
			TeamTypeClass* tt = TeamTypes.Ptr(tti);
			if (!tt || !tt->IsActive) continue;
			if (!ttfirst) buf_cat(",");
			ttfirst = false;
			buf_cat("{\"i\":%d,\"name\":\"%s\",\"house\":\"%s\","
				"\"prebuilt\":%s,\"autocreate\":%s,\"reinforcable\":%s,"
				"\"transient\":%s,\"number\":%d,\"init\":%u,\"max\":%u,"
				"\"members\":[",
				tti,
				tt->IniName,
				agent_house_name(tt->House),
				tt->IsPrebuilt ? "true" : "false",
				tt->IsAutocreate ? "true" : "false",
				tt->IsReinforcable ? "true" : "false",
				tt->IsTransient ? "true" : "false",
				tt->Number,
				(unsigned)tt->InitNum,
				(unsigned)tt->MaxAllowed);
			for (int mi = 0; mi < tt->ClassCount; mi++) {
				if (mi > 0) buf_cat(",");
				TechnoTypeClass const * wantType = tt->Members[mi].Class;
				buf_cat("{\"type\":\"%s\",\"want\":%d,\"rtti\":%d}",
					wantType ? wantType->IniName : "?",
					tt->Members[mi].Quantity,
					wantType ? (int)wantType->What_Am_I() : -1);
			}
			buf_cat("]}");
		}
	}
	buf_cat("]}");
	// Don't reset here — debugMoves persist until agent_step runs next tick

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
	// Don't reset debug log on the FIRST agent_step — preserve init-time entries
	static bool first_step = true;
	if (!first_step) {
		g_debug_move_count = 0;
		g_debug_move_idx = 0;
	}
	first_step = false;
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

/* ======================================================================
 * EXPORT 4: agent_get_cell_occupiers — serialize a cell's OccupierPtr chain.
 * Generic diagnostics for TechnoClass::Evaluate_Cell parity. This does not
 * mutate game state; it only exposes the exact linked list that C++ scans.
 * ====================================================================== */
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* agent_get_cell_occupiers(int cx, int cy)
{
	buf_init(s_cmd_buf, CMD_BUF_SIZE);

	if (cx < 0 || cx >= MAP_CELL_W || cy < 0 || cy >= MAP_CELL_H) {
		buf_cat("{\"error\":\"out-of-bounds\",\"cx\":%d,\"cy\":%d}", cx, cy);
		return s_cmd_buf;
	}

	CELL cell = XY_Cell(cx, cy);
	CellClass* cellptr = &Map[cell];
	buf_cat("{\"tick\":%ld,\"rngState\":%lu,\"cx\":%d,\"cy\":%d,\"cell\":%d,\"occ\":[",
		Frame, (unsigned long)Scen.RandomNumber.Seed, cx, cy, (int)cell);
	bool first = true;
	ObjectClass* object = cellptr->Cell_Occupier();
	int depth = 0;
	while (object != NULL && depth < 16) {
		if (!first) buf_cat(",");
		first = false;
		RTTIType rtti = object->What_Am_I();
		int idx = agent_object_index(object, rtti);
		int aid = idx >= 0 ? AGENT_ID(rtti, idx) : -1;
		const char* tname = object->Class_Of().Name();
		const char* hname = "None";
		int mission = -1;
		int lx = -1;
		int ly = -1;
		bool is_techno = object->Is_Techno();
		bool in_limbo = object->IsInLimbo;
		bool owned_player = false;
		bool discovered_player = false;
		int strength = -1;
		int mission_timer = -1;
		int mission_queue = -1;
		bool is_driving = false;
		int tarx = 0, tary = 0, tar_kind = -1, tar_value = -1, tar_rtti = -1, tar_obj_index = -1;
		int navx = 0, navy = 0, nav_kind = -1, nav_value = -1;
		if (is_techno) {
			TechnoClass* tech = (TechnoClass*)object;
			hname = agent_house_name(tech->Owner());
			mission = (int)tech->Get_Mission();
			COORDINATE coord = tech->Center_Coord();
			lx = (int)Coord_X(coord);
			ly = (int)Coord_Y(coord);
			owned_player = tech->IsOwnedByPlayer;
			discovered_player = tech->IsDiscoveredByPlayer;
			strength = (int)tech->Strength;
			if (rtti == RTTI_INFANTRY || rtti == RTTI_UNIT || rtti == RTTI_AIRCRAFT || rtti == RTTI_VESSEL) {
				FootClass* foot = (FootClass*)object;
				mission_timer = foot->Get_Mission_Timer_Value();
				mission_queue = (int)foot->MissionQueue;
				is_driving = foot->IsDriving;
				if (Target_Legal(foot->TarCom)) {
					COORDINATE tc = As_Coord(foot->TarCom);
					tarx = (int)Coord_X(tc);
					tary = (int)Coord_Y(tc);
					tar_kind = (int)Target_Kind(foot->TarCom);
					tar_value = (int)Target_Value(foot->TarCom);
					ObjectClass* tobj = As_Object(foot->TarCom);
					if (tobj) {
						tar_rtti = (int)tobj->What_Am_I();
						tar_obj_index = agent_object_index(tobj, tobj->What_Am_I());
					}
				}
				if (Target_Legal(foot->NavCom)) {
					COORDINATE nc = As_Coord(foot->NavCom);
					navx = (int)Coord_X(nc);
					navy = (int)Coord_Y(nc);
					nav_kind = (int)Target_Kind(foot->NavCom);
					nav_value = (int)Target_Value(foot->NavCom);
				}
			}
		}
		buf_cat("{\"d\":%d,\"id\":%d,\"rtti\":%d,\"t\":\"%s\",\"house\":\"%s\","
			"\"tech\":%s,\"down\":%s,\"toDamage\":%s,\"limbo\":%s,"
			"\"m\":%d,\"mt\":%d,\"mq\":%d,\"drv\":%s,\"lx\":%d,\"ly\":%d,\"hp\":%d,"
			"\"tarX\":%d,\"tarY\":%d,\"tarKind\":%d,\"tarValue\":%d,\"tarRtti\":%d,\"tarIdx\":%d,"
			"\"navX\":%d,\"navY\":%d,\"navKind\":%d,\"navValue\":%d,"
			"\"op\":%s,\"dp\":%s}",
			depth, aid, (int)rtti, tname, hname,
			is_techno ? "true" : "false",
			object->IsDown ? "true" : "false",
			object->IsToDamage ? "true" : "false",
			in_limbo ? "true" : "false",
			mission, mission_timer, mission_queue, is_driving ? "true" : "false",
			lx, ly, strength,
			tarx, tary, tar_kind, tar_value, tar_rtti, tar_obj_index,
			navx, navy, nav_kind, nav_value,
			owned_player ? "true" : "false",
			discovered_player ? "true" : "false");
		object = object->Next;
		depth++;
	}
	buf_cat("]}");
	return s_cmd_buf;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* agent_get_cell_info(int cx, int cy, int infantry_id)
{
	buf_init(s_cmd_buf, CMD_BUF_SIZE);

	if (cx < 0 || cx >= MAP_CELL_W || cy < 0 || cy >= MAP_CELL_H) {
		buf_cat("{\"error\":\"out-of-bounds\",\"cx\":%d,\"cy\":%d}", cx, cy);
		return s_cmd_buf;
	}

	CELL cell = XY_Cell(cx, cy);
	CellClass* cellptr = &Map[cell];
	LandType land = cellptr->Land_Type();
	bool foot_zero = (Ground[land].Cost[SPEED_FOOT] == 0);
	bool in_radar = Map.In_Radar(cell);

	int can_enter = -1;
	TechnoClass* tech = agent_lookup(infantry_id);
	if (tech != NULL) {
		if (tech->What_Am_I() == RTTI_INFANTRY) {
			can_enter = (int)((InfantryClass*)tech)->Can_Enter_Cell(cell);
		} else if (tech->What_Am_I() == RTTI_UNIT) {
			can_enter = (int)((UnitClass*)tech)->Can_Enter_Cell(cell);
		} else if (tech->What_Am_I() == RTTI_VESSEL) {
			can_enter = (int)((VesselClass*)tech)->Can_Enter_Cell(cell);
		}
	}

	buf_cat("{\"cx\":%d,\"cy\":%d,\"cell\":%d,\"ttype\":%d,\"ticon\":%d,"
		"\"overlay\":%d,\"overlayData\":%d,"
		"\"land\":%d,\"mapped\":%s,\"visible\":%s,\"footZero\":%s,\"inRadar\":%s,\"canEnter\":%d,"
		"\"flag\":%d,\"infType\":%d}",
		cx, cy, (int)cell, (int)cellptr->TType, (int)cellptr->TIcon,
		(int)cellptr->Overlay, (int)cellptr->OverlayData,
		(int)land, cellptr->IsMapped ? "true" : "false", cellptr->IsVisible ? "true" : "false",
		foot_zero ? "true" : "false", in_radar ? "true" : "false",
		can_enter, (int)cellptr->Flag.Composite, (int)cellptr->InfType);
	return s_cmd_buf;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* agent_get_radar_info(void)
{
	buf_init(s_cmd_buf, CMD_BUF_SIZE);

	CELL radar = Map.Radar_Position();
	CELL tactical = Coord_Cell(Map.TacticalCoord);
	int radar_px = 0;
	int radar_py = 0;
	Map.Cell_XY_To_Radar_Pixel(Cell_X(radar), Cell_Y(radar), radar_px, radar_py);

	buf_cat("{\"radarCell\":%d,\"radarX\":%d,\"radarY\":%d,"
		"\"tacticalCell\":%d,\"tacticalX\":%d,\"tacticalY\":%d,"
		"\"radarPx\":%d,\"radarPy\":%d,\"isZoomed\":%d,"
		"\"radX\":%d,\"radY\":%d,\"radOffX\":%d,\"radOffY\":%d,"
		"\"radIWidth\":%d,\"radIHeight\":%d,\"radWidth\":%d,\"radHeight\":%d}",
		(int)radar, Cell_X(radar), Cell_Y(radar),
		(int)tactical, Cell_X(tactical), Cell_Y(tactical),
		radar_px, radar_py, Map.Is_Zoomed() ? 1 : 0,
		Map.RadX, Map.RadY, Map.RadOffX, Map.RadOffY,
		Map.RadIWidth, Map.RadIHeight, Map.RadWidth, Map.RadHeight);
	return s_cmd_buf;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* agent_debug_find_path(int foot_id, int cx, int cy, int threshold)
{
	buf_init(s_cmd_buf, CMD_BUF_SIZE);
	TechnoClass* tech = agent_lookup(foot_id);
	if (tech == NULL || !tech->Is_Foot()) {
		buf_cat("{\"error\":\"foot-not-found\",\"id\":%d}", foot_id);
		return s_cmd_buf;
	}
	if (cx < 0 || cx >= MAP_CELL_W || cy < 0 || cy >= MAP_CELL_H) {
		buf_cat("{\"error\":\"out-of-bounds\",\"cx\":%d,\"cy\":%d}", cx, cy);
		return s_cmd_buf;
	}

	FootClass* foot = (FootClass*)tech;
	FacingType workpath[200];
	for (int i = 0; i < 200; i++) workpath[i] = FACING_NONE;
	PathType* path = foot->Agent_Debug_Find_Path(XY_Cell(cx, cy), &workpath[0], sizeof(workpath), (MoveType)threshold);
	if (path == NULL) {
		buf_cat("{\"id\":%d,\"threshold\":%d,\"path\":null}", foot_id, threshold);
		return s_cmd_buf;
	}

	buf_cat("{\"id\":%d,\"threshold\":%d,\"cost\":%d,\"length\":%d,\"path\":[",
		foot_id, threshold, path->Cost, path->Length);
	int limit = path->Length < 80 ? path->Length : 80;
	for (int i = 0; i < limit; i++) {
		if (i) buf_cat(",");
		buf_cat("%d", (int)workpath[i]);
	}
	buf_cat("]}");
	return s_cmd_buf;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
char* agent_debug_eval_target(int scanner_id, int target_id)
{
	buf_init(s_cmd_buf, CMD_BUF_SIZE);

	TechnoClass* scanner = agent_lookup(scanner_id);
	TechnoClass* target = agent_lookup(target_id);
	if (scanner == NULL || target == NULL) {
		buf_cat("{\"error\":\"lookup\",\"scanner\":%s,\"target\":%s}",
			scanner == NULL ? "false" : "true",
			target == NULL ? "false" : "true");
		return s_cmd_buf;
	}

	ThreatType method = THREAT_RANGE;
	TechnoTypeClass* stype = scanner->Techno_Type_Class();
	if (stype->PrimaryWeapon != NULL) {
		method = (ThreatType)(method | stype->PrimaryWeapon->Allowed_Threats());
	}
	if (stype->SecondaryWeapon != NULL) {
		method = (ThreatType)(method | stype->SecondaryWeapon->Allowed_Threats());
	}

	int mask = 0;
	if (method & THREAT_CIVILIANS) mask |= ((1 << RTTI_BUILDING) | (1 << RTTI_INFANTRY) | (1 << RTTI_UNIT));
	if (method & THREAT_AIR) mask |= (1 << RTTI_AIRCRAFT);
	if (method & THREAT_CAPTURE) mask |= (1 << RTTI_BUILDING);
	if (method & (THREAT_CIVILIANS|THREAT_BUILDINGS|THREAT_FACTORIES|THREAT_POWER|THREAT_FAKES|THREAT_BASE_DEFENSE|THREAT_TIBERIUM)) mask |= (1 << RTTI_BUILDING);
	if (method & (THREAT_CIVILIANS|THREAT_INFANTRY|THREAT_BASE_DEFENSE)) mask |= (1 << RTTI_INFANTRY);
	if (method & THREAT_VEHICLES) mask |= (1 << RTTI_UNIT);
	if (method & THREAT_BASE_DEFENSE) mask |= (1 << RTTI_BUILDING);
	if (method & THREAT_BOATS) mask |= (1 << RTTI_VESSEL);
	if (method & THREAT_VEHICLES) mask |= (1 << RTTI_AIRCRAFT);

	int range = scanner->Threat_Range(0);
	int primary = scanner->What_Weapon_Should_I_Use(target->As_Target());
	int can0 = (int)scanner->Can_Fire(target->As_Target(), 0);
	int can1 = (int)scanner->Can_Fire(target->As_Target(), 1);
	int canPrimary = (int)scanner->Can_Fire(target->As_Target(), primary);
	int value = -9999;
	bool eval = scanner->Evaluate_Object(method, mask, range, target, value, -1);
	bool in_range = scanner->In_Range(target, primary);
	int dist = Distance(scanner->Fire_Coord(primary), target->Center_Coord());

	TechnoClass const* cell_obj = NULL;
	int cell_value = -9999;
	bool cell_eval = scanner->Evaluate_Cell(method, mask, Coord_Cell(target->Center_Coord()), range, &cell_obj, cell_value, -1);
	int cell_obj_id = -1;
	if (cell_obj != NULL) {
		int idx = agent_object_index((ObjectClass*)cell_obj, cell_obj->What_Am_I());
		if (idx >= 0) cell_obj_id = AGENT_ID(cell_obj->What_Am_I(), idx);
	}

	TARGET best = scanner->Greatest_Threat(THREAT_RANGE);
	int best_id = -1;
	int best_cx = -1;
	int best_cy = -1;
	if (Target_Legal(best)) {
		COORDINATE bc = As_Coord(best);
		best_cx = Cell_X(Coord_Cell(bc));
		best_cy = Cell_Y(Coord_Cell(bc));
		if (Is_Target_Object(best)) {
			ObjectClass* best_obj = As_Object(best);
			int idx = agent_object_index(best_obj, best_obj->What_Am_I());
			if (idx >= 0) best_id = AGENT_ID(best_obj->What_Am_I(), idx);
		}
	}

	buf_cat("{\"scanner\":%d,\"target\":%d,\"method\":%d,\"mask\":%d,"
		"\"range\":%d,\"primary\":%d,\"can0\":%d,\"can1\":%d,\"canPrimary\":%d,\"dist\":%d,\"inRange\":%s,"
		"\"eval\":%s,\"value\":%d,\"cellEval\":%s,\"cellValue\":%d,"
		"\"cellObj\":%d,\"bestLegal\":%s,\"bestId\":%d,\"bestCell\":\"(%d,%d)\","
		"\"ally\":%s,\"noThreat\":%s,\"targetMission\":%d,"
		"\"targetType\":\"%s\",\"targetHouse\":\"%s\",\"targetStrength\":%d,"
		"\"targetCx\":%d,\"targetCy\":%d,"
		"\"targetLegal\":%s,\"targetOwnedPlayer\":%s,\"targetDiscovered\":%s,"
		"\"scannerLocked\":%s,\"targetLimbo\":%s,\"targetCloak\":%d}",
		scanner_id, target_id, (int)method, mask,
		range, primary, can0, can1, canPrimary, dist, in_range ? "true" : "false",
		eval ? "true" : "false", value, cell_eval ? "true" : "false", cell_value,
		cell_obj_id, Target_Legal(best) ? "true" : "false", best_id, best_cx, best_cy,
		scanner->House->Is_Ally(target) ? "true" : "false",
		MissionControl[target->Get_Mission()].IsNoThreat ? "true" : "false",
		(int)target->Get_Mission(),
		target->Class_Of().Name(),
		agent_house_name(target->Owner()),
		(int)target->Strength,
		Cell_X(Coord_Cell(target->Center_Coord())),
		Cell_Y(Coord_Cell(target->Center_Coord())),
		target->Class_Of().IsLegalTarget ? "true" : "false",
		target->IsOwnedByPlayer ? "true" : "false",
		target->IsDiscoveredByPlayer ? "true" : "false",
		scanner->IsLocked ? "true" : "false",
		target->IsInLimbo ? "true" : "false",
		(int)target->Cloak);
	return s_cmd_buf;
}

/* ======================================================================
 * EXPORT 5: agent_render — force a visual frame render for screenshots.
 * Temporarily disables the autoplay rendering skip so that Map.Render()
 * + SDL blit actually pushes pixels to the canvas. After rendering,
 * copies the canvas to window.__agentFrame as a data URL.
 * ====================================================================== */
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void agent_render(void)
{
	/* Read the HidPage back buffer which Main_Loop already renders to.
	 * In agent mode, Map.Render() runs inside do_tick→Main_Loop every tick.
	 * We just need to read the 8-bit paletted pixels and convert to RGBA. */
	int w = HidPage.Get_Width();
	int h = HidPage.Get_Height();
	if (w <= 0 || h <= 0) { w = 320 * RESFACTOR; h = 200 * RESFACTOR; }
	uint8_t *src = (uint8_t*)HidPage.Get_Offset();
	if (!src) return;

	static uint8_t rgba[640 * 400 * 4]; // big enough for HIRES
	int total = w * h;
	for (int i = 0; i < total; i++) {
		uint8_t idx = src[i];
		const RGBClass &c = GamePalette[idx];
		rgba[i*4+0] = c.Red_Component();
		rgba[i*4+1] = c.Green_Component();
		rgba[i*4+2] = c.Blue_Component();
		rgba[i*4+3] = 255;
	}
	/* Count non-zero pixels for diagnostics */
	int nonZero = 0;
	for (int i = 0; i < total; i++) { if (src[i] != 0) nonZero++; }

	int ptr = (int)(uintptr_t)rgba;
	EM_ASM_INT({ window.__agentFramePtr = $0; return 0; }, ptr);
	EM_ASM_INT({ window.__agentFrameNonZero = $0; return 0; }, nonZero);
}

} /* extern "C" */
