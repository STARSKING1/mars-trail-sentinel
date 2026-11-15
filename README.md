# Mars Trail Sentinel

## Live Deployment

Launch the interactive **ARES-NAV** mission control prototype directly in your browser with zero local setup:

**Live Mission Control App:** [https://mars-trail-sentinel.vercel.app/](https://mars-trail-sentinel.vercel.app/)
 **What You Can Test Immediately:**
 **Offline-First Spatial Engine:** Local IndexedDB terrain caching for uninterrupted field navigation without active telemetry links.

we wanted to build ARES-NAV (Autonomous Reconnaissance & EVA Survival Navigator) as a working, production-grade web application for the 2026 NASA Space Apps Challenge (Interplanetary Survival Guide: Martian Map).

Target Location & Science Objective: Mount Sharp (Aeolis Mons) Boxwork Formations & Gediz Vallis Margin, Gale Crater (-4.6°S, 137.4°E). Astronauts conduct an EVA to sample mineral-filled fracture ridges while managing steep alluvial slopes, loose regolith traps, and solar radiation.

Core Architecture & Views:
1. Dual Tactical Interface:
   - Habitat / Rover Mission Control: 2.5D multi-layer tactical map fusing optical/slope, CRISM-style mineralogy (hydrated sulfates, phyllosilicates, hematite), THEMIS thermal inertia (identifying bedrock vs dust traps), DTM sky-view radiation shielding factor, and UHF radio viewshed Line-of-Sight (LoS) to the habitat relay.
   - Suit Visor HUD / Wrist Tablet: High-contrast astronaut tactical field display showing live suit consumables (oxygen, battery, cooling water), cumulative radiation dose (mSv), radio LoS status, turn-by-turn waypoint guidance, and rover POV terrain previews.
   - Live Mode Toggle: Seamless switching between Habitat Map and Visor HUD.

2. Navigation & Survival Engine:
   - Multi-objective A* solver supporting presets: Balanced, Max Safety, and Max Science.
   - Kinematic safety limits: Hard lockout for slopes >15° on low thermal inertia (<150 TI regolith) and >22° on exposed bedrock.
   - Pandolf-Santee bioenergetics: Real-time metabolic rate, oxygen and battery consumption scaled for Mars gravity (3.72 m/s²), speed, and incline.
   - Point-of-No-Return (PNR) margin assessment: Reverse-path calculation with Caution (30% reserve) and Critical (15% reserve) abort triggers.
   - Dynamic Solar Particle Event (SEP) abort: One-click "Simulate Solar Particle Event" that spikes ambient radiation 10x and instantly recomputes an emergency evacuation path to the nearest low-sky-view cliff shelter or habitat relay.

3. Offline-First & Provenance Integrity:
   - Installable PWA with Service Worker and IndexedDB offline spatial caching for 0-latency operation during Martian comms blackouts.
   - Scientific Provenance: Clear labeling distinguishing synthetic calibrated Gale Crater models from validated NASA mission data (HiRISE, CRISM, THEMIS, RAD, REMS). No reliance on deprecated NASA APIs. Illustrative waypoint scenes clearly labeled.

Build a real, responsive, beautifully styled Mars tactical web app with rich controls, terrain layer toggles, interactive route planning, waypoint modals, telemetry charts, and emergency abort flows.


## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
