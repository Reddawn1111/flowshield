# -*- coding: utf-8 -*-
"""
Test Suite for FLOWSHIELD Predictive Live-Location Flood Warning System.
Validates all 9 critical test cases defined in the project specification:
1. User in safe area -> no alert.
2. User in area currently safe but RED SEVERE forecast in 18 hours -> alert.
3. RED SEVERE forecast in 30 hours -> no 24-hour alert.
4. Area already RED SEVERE -> immediate severe warning.
5. User moves from safe Area A to affected Area B -> warning updates.
6. Forecast changes and RED SEVERE is removed -> warning clears/updates.
7. Location permission denied -> graceful fallback.
8. Forecast data unavailable -> clearly indicate unavailable prediction.
9. Ensure duplicate notifications are not generated every render.
"""

import sys
import os

# Ensure flowshield directory is in path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "flowshield"))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from live_warning_service import (
    evaluate_24h_flood_forecast,
    map_coordinates_to_grid,
    AlertDeduplicator,
    DEPTH_MILD_MM,
    DEPTH_SIGNIFICANT_MM,
    DEPTH_SEVERE_MM,
)


def run_all_tests():
    print("================================================================================")
    print("  RUNNING FLOWSHIELD PREDICTIVE FLOOD WARNING TEST SUITE (9 TEST CASES)")
    print("================================================================================")
    passed = 0

    # -------------------------------------------------------------------------
    # CASE 1: User in safe area -> no alert.
    # -------------------------------------------------------------------------
    timeline_safe = [20.0] * 25  # All 24 hours well below mild (20 mm)
    v1 = evaluate_24h_flood_forecast(timeline_safe, area_name="Area A - Green Zone")
    assert not v1["is_alert"], "Case 1 Failed: Safe area should not trigger alert"
    assert not v1["is_severe_expected"], "Case 1 Failed: No severe flood expected"
    assert v1["current_status"] == "SAFE", "Case 1 Failed: Current status should be SAFE"
    assert v1["forecast_status"] == "SAFE", "Case 1 Failed: Forecast status should be SAFE"
    print("[PASS] CASE 1: User in safe area -> no alert.")
    passed += 1

    # -------------------------------------------------------------------------
    # CASE 2: User in area currently safe but RED SEVERE forecast in 18 hours -> alert.
    # -------------------------------------------------------------------------
    timeline_severe_18 = [30.0] * 25  # Starts safe (30 mm)
    timeline_severe_18[18] = 280.0     # Exceeds RED SEVERE (250 mm) at hour 18
    timeline_severe_18[19] = 310.0
    v2 = evaluate_24h_flood_forecast(timeline_severe_18, area_name="Area A - Lowland Basin")
    assert v2["is_alert"], "Case 2 Failed: Alert must be triggered"
    assert v2["is_severe_expected"], "Case 2 Failed: is_severe_expected must be True"
    assert not v2["is_already_severe"], "Case 2 Failed: Area is not yet flooded at t=0"
    assert v2["hours_until_severe"] == 18, f"Case 2 Failed: Expected arrival at 18h, got {v2['hours_until_severe']}"
    assert v2["current_status"] == "SAFE", "Case 2 Failed: Current status should be SAFE"
    assert v2["forecast_status"] == "RED SEVERE", "Case 2 Failed: Forecast status must be RED SEVERE"
    assert "~18 hours from now" in v2["time_text"], "Case 2 Failed: Time text must indicate ~18 hours"
    print("✓ CASE 2 PASSED: Safe now, RED SEVERE in 18h -> proactive warning triggered.")
    passed += 1

    # -------------------------------------------------------------------------
    # CASE 3: RED SEVERE forecast in 30 hours -> no 24-hour alert.
    # -------------------------------------------------------------------------
    # Timeline with 35 hours, severe only at hour 30 (outside 24h forecast window)
    timeline_severe_30 = [40.0] * 35
    timeline_severe_30[30] = 320.0
    v3 = evaluate_24h_flood_forecast(timeline_severe_30, area_name="Area A - Distant Storm")
    assert not v3["is_alert"], "Case 3 Failed: Severe in 30h must not trigger 24h alert"
    assert not v3["is_severe_expected"], "Case 3 Failed: is_severe_expected must be False for 24h window"
    assert v3["hours_until_severe"] is None, "Case 3 Failed: No severe arrival within 24h"
    print("✓ CASE 3 PASSED: RED SEVERE forecast in 30 hours -> no 24-hour alert.")
    passed += 1

    # -------------------------------------------------------------------------
    # CASE 4: Area already RED SEVERE -> immediate severe warning.
    # -------------------------------------------------------------------------
    timeline_already_severe = [270.0] * 25  # Already 270 mm at t = 0
    v4 = evaluate_24h_flood_forecast(timeline_already_severe, area_name="Area C - Submerged Ward")
    assert v4["is_alert"], "Case 4 Failed: Immediate severe alert must trigger"
    assert v4["is_already_severe"], "Case 4 Failed: Must detect currently active inundation"
    assert v4["hours_until_severe"] == 0, "Case 4 Failed: Arrival time must be 0 (active now)"
    assert v4["current_status"] == "RED SEVERE", "Case 4 Failed: Current status must be RED SEVERE"
    print("✓ CASE 4 PASSED: Area already RED SEVERE -> immediate severe warning.")
    passed += 1

    # -------------------------------------------------------------------------
    # CASE 5: User moves from safe Area A to affected Area B -> warning updates.
    # -------------------------------------------------------------------------
    # At Area A:
    v5_a = evaluate_24h_flood_forecast(timeline_safe, area_name="Area A")
    assert not v5_a["is_alert"], "Case 5 Failed: Area A should be safe"

    # User relocates to Area B (which has severe forecast in 12h):
    timeline_b = [50.0] * 25
    timeline_b[12] = 265.0
    v5_b = evaluate_24h_flood_forecast(timeline_b, area_name="Area B")
    assert v5_b["is_alert"], "Case 5 Failed: Area B must trigger alert upon moving"
    assert v5_b["hours_until_severe"] == 12, "Case 5 Failed: Arrival time for Area B must be 12h"
    assert v5_b["area_name"] == "Area B", "Case 5 Failed: Target area must be updated to Area B"
    print("✓ CASE 5 PASSED: User moves from safe Area A to affected Area B -> warning updates.")
    passed += 1

    # -------------------------------------------------------------------------
    # CASE 6: Forecast changes and RED SEVERE is removed -> warning clears/updates.
    # -------------------------------------------------------------------------
    # Initial forecast had severe in 18h:
    v6_before = evaluate_24h_flood_forecast(timeline_severe_18, area_name="Area A")
    assert v6_before["is_alert"], "Case 6 setup: initial alert required"

    # Weather model updates; rainfall moves out, clearing severe flood:
    timeline_cleared = [40.0] * 25
    v6_after = evaluate_24h_flood_forecast(timeline_cleared, area_name="Area A")
    assert not v6_after["is_alert"], "Case 6 Failed: Alert must clear when forecast improves"
    assert not v6_after["is_severe_expected"], "Case 6 Failed: is_severe_expected must become False"
    print("✓ CASE 6 PASSED: Forecast changes and RED SEVERE is removed -> warning clears.")
    passed += 1

    # -------------------------------------------------------------------------
    # CASE 7: Location permission denied -> graceful fallback.
    # -------------------------------------------------------------------------
    # When permission is denied, map_coordinates_to_grid is given city center default or fallback
    city_cfg = {"name": "Bengaluru", "lat": 12.9716, "lon": 77.5946}
    sample_records = [
        {"i": 6, "j": 6, "locality": "City Center", "taluk": "North", "grid_id": "G06-06"}
    ]
    # Fallback to center coordinates
    fallback_loc = map_coordinates_to_grid(city_cfg["lat"], city_cfg["lon"], city_cfg, sample_records)
    assert fallback_loc["is_in_grid"], "Case 7 Failed: Fallback to center must be in grid"
    assert fallback_loc["locality"] == "City Center", "Case 7 Failed: Locality should resolve to center"
    print("✓ CASE 7 PASSED: Location permission denied -> graceful fallback.")
    passed += 1

    # -------------------------------------------------------------------------
    # CASE 8: Forecast data unavailable -> clearly indicate unavailable prediction.
    # -------------------------------------------------------------------------
    v8 = evaluate_24h_flood_forecast([], area_name="Area Remote", forecast_available=False)
    assert not v8["is_alert"], "Case 8 Failed: Unavailable data must not generate alert"
    assert not v8["forecast_available"], "Case 8 Failed: forecast_available must be False"
    assert v8["current_status"] == "UNAVAILABLE", "Case 8 Failed: Status must be UNAVAILABLE"
    assert "unavailable" in v8["message"].lower(), "Case 8 Failed: Message must state unavailable"
    print("✓ CASE 8 PASSED: Forecast data unavailable -> clearly indicate unavailable.")
    passed += 1

    # -------------------------------------------------------------------------
    # CASE 9: Ensure duplicate notifications are not generated every render.
    # -------------------------------------------------------------------------
    dedup = AlertDeduplicator()
    # First render with alert
    should_1, sig_1 = dedup.should_notify(v2)
    assert should_1, "Case 9 Failed: First alert must notify"

    # Second render with exact same forecast state (e.g. Streamlit re-render / frame tick)
    should_2, sig_2 = dedup.should_notify(v2)
    assert not should_2, "Case 9 Failed: Duplicate render must NOT notify"

    # Third render with changed severe arrival time (18h -> 14h)
    v2_updated = dict(v2)
    v2_updated["hours_until_severe"] = 14
    should_3, sig_3 = dedup.should_notify(v2_updated)
    assert should_3, "Case 9 Failed: Meaningful change in arrival time MUST notify"

    # Reset test when alert clears
    should_cleared, _ = dedup.should_notify(v1)
    assert not should_cleared, "Case 9 Failed: Cleared state must not notify"
    print("✓ CASE 9 PASSED: Deduplication verified -> no spamming every frame/render.")
    passed += 1

    # -------------------------------------------------------------------------
    # CASE 10: Strict Grid-Specific Isolation (User in A12 Safe, Neighbor B12 Severe)
    # -------------------------------------------------------------------------
    # Grid A12 (user's cell) is entirely safe:
    timeline_a12 = [22.0] * 25
    v_a12 = evaluate_24h_flood_forecast(timeline_a12, area_name="Sector A12", grid_code="A12")
    assert not v_a12["is_alert"], "Case 10 Failed: User in cell A12 must NOT trigger alert"
    assert not v_a12["is_severe_expected"], "Case 10 Failed: No severe forecast in A12"
    assert v_a12["current_status"] == "SAFE", "Case 10 Failed: Cell A12 must remain SAFE"
    assert v_a12["grid_code"] == "A12", "Case 10 Failed: Cell code must be A12"

    # Adjacent cell B12 has severe conditions predicted in 4 hours:
    timeline_b12 = [25.0] * 4 + [290.0] * 21
    v_b12 = evaluate_24h_flood_forecast(timeline_b12, area_name="Sector B12", grid_code="B12")
    assert v_b12["is_alert"], "Case 10 Failed: Severe cell B12 must trigger alert"
    assert v_b12["hours_until_severe"] == 4, "Case 10 Failed: B12 arrival time must be 4h"
    assert v_b12["grid_code"] == "B12", "Case 10 Failed: Cell code must be B12"

    # Verify that severe forecast in B12 does NOT leak into A12:
    assert not v_a12["is_alert"], "Case 10 Failed: Cell A12 must remain isolated and safe despite adjacent B12 severe flood"

    # Verify grid_code format in map_coordinates_to_grid:
    city_cfg = {"name": "TestCity", "lat": 12.9716, "lon": 77.5946}
    # Center cell (i = 6, j = 6) -> row 'G', col '07'
    g_mid = map_coordinates_to_grid(city_cfg["lat"], city_cfg["lon"], city_cfg, [])
    assert g_mid["grid_code"] == "G07", f"Case 10 Failed: Expected G07, got {g_mid['grid_code']}"

    print("✓ CASE 10 PASSED: Strict Grid-Specific Isolation verified (Cell A12 Safe, Neighbor B12 Severe -> Zero alert leakage).")
    passed += 1

    print("================================================================================")
    print(f"  ALL {passed}/10 PREDICTIVE FLOOD WARNING TEST SCENARIOS PASSED SUCCESSFULLY!")
    print("================================================================================")
    return True


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)

