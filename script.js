document.addEventListener("DOMContentLoaded", () => {
  // --- Configuration ---
  const GRID_SIZE = 30; // Number of cells horizontally and vertically
  const CELL_SIZE = 20; // Size of each cell in pixels
  const RUNWAY_START_ROW = Math.floor(GRID_SIZE / 2) - 1;
  const RUNWAY_END_ROW = Math.floor(GRID_SIZE / 2) + 1;
  const RUNWAY_COL = GRID_SIZE - 1; // Runway on the right edge

  const UPDATE_INTERVAL_MS = 100; // How often the game state updates (milliseconds)
  const SAFE_DISTANCE_SQUARED = 4 * 4; // Minimum safe distance (squared for efficiency) - 4 cells

  // --- DOM Elements ---
  const airspaceGrid = document.getElementById("airspace");
  const speedSlider = document.getElementById("speed-slider");
  const speedValueDisplay = document.getElementById("speed-value");
  const spawnRateSlider = document.getElementById("spawn-rate-slider");
  const spawnRateValueDisplay = document.getElementById("spawn-rate-value");
  const resetButton = document.getElementById("reset-button");
  const activeAircraftDisplay = document.getElementById("active-aircraft");
  const landedAircraftDisplay = document.getElementById("landed-aircraft");
  const collisionsDisplay = document.getElementById("collisions");
  const messageLog = document.getElementById("message-log");

  // --- Game State ---
  let aircraft = [];
  let aircraftCounter = 0; // To give unique IDs/callsigns
  let gameInterval = null;
  let tilesPerSecond = parseFloat(speedSlider.value); // Initialize from slider's default value
  let spawnInterval = null;
  let landedCount = 0;
  let collisionCount = 0;
  let selectedAircraft = null;
  let isGameOver = false;

  // --- Initialization ---
  function setupGrid() {
    airspaceGrid.innerHTML = ""; // Clear previous grid elements
    airspaceGrid.style.gridTemplateColumns = `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`;
    airspaceGrid.style.gridTemplateRows = `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`;
    airspaceGrid.style.width = `${GRID_SIZE * CELL_SIZE}px`;
    airspaceGrid.style.height = `${GRID_SIZE * CELL_SIZE}px`;

    // Add Runway
    for (let r = RUNWAY_START_ROW; r <= RUNWAY_END_ROW; r++) {
      const runwaySegment = document.createElement("div");
      runwaySegment.classList.add("runway");
      runwaySegment.style.position = "absolute";
      runwaySegment.style.left = `${RUNWAY_COL * CELL_SIZE}px`;
      runwaySegment.style.top = `${r * CELL_SIZE}px`;
      runwaySegment.style.width = `${CELL_SIZE}px`;
      runwaySegment.style.height = `${CELL_SIZE}px`;
      airspaceGrid.appendChild(runwaySegment);
    }

    // Add click listener to the grid for setting waypoints
    airspaceGrid.addEventListener("click", handleGridClick);

    logMessage("Grid initialized.");
  }

  function resetSimulation() {
    logMessage("Resetting simulation...");
    isGameOver = false;
    stopGameLoop();
    stopSpawning();
    aircraft.forEach((ac) => ac.element.remove()); // Remove aircraft elements
    aircraft = [];
    aircraftCounter = 0;
    landedCount = 0;
    collisionCount = 0;
    selectedAircraft = null;
    // Reset sliders and displays to default
    speedSlider.value = 0.5;
    tilesPerSecond = 0.5;
    speedValueDisplay.textContent = tilesPerSecond.toFixed(1);
    spawnRateSlider.value = 5;
    spawnRateValueDisplay.textContent = 5;
    updateStatusDisplay(); // Update counts display
    messageLog.innerHTML = ""; // Clear log
    setupGrid(); // Re-draw grid and runway
    startGameLoop();
    startSpawning(); // Use default spawn rate from slider
    logMessage("Simulation reset complete.");
  }

  // --- Logging ---
  function logMessage(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement("div");
    logEntry.textContent = `[${timestamp}] ${message}`;
    // Find first child to insert before, keeps latest at bottom
    messageLog.insertBefore(logEntry, messageLog.firstChild);
    // Keep log size manageable (optional)
    while (messageLog.childNodes.length > 100) {
      messageLog.removeChild(messageLog.lastChild);
    }
  }

  // --- Aircraft Creation ---
  function createAircraft() {
    aircraftCounter++;
    const callsign = `FL${String(aircraftCounter).padStart(3, "0")}`;

    // Spawn randomly on left, top, or bottom edge (avoiding corners initially)
    let startX, startY;
    const edge = Math.floor(Math.random() * 3); // 0: left, 1: top, 2: bottom

    if (edge === 0) {
      // Left edge
      startX = 0;
      startY = Math.random() * GRID_SIZE;
    } else if (edge === 1) {
      // Top edge
      startX = Math.random() * (GRID_SIZE - 1); // Avoid runway column
      startY = 0;
    } else {
      // Bottom edge
      startX = Math.random() * (GRID_SIZE - 1); // Avoid runway column
      startY = GRID_SIZE - 1;
    }

    const ac = {
      id: aircraftCounter,
      callsign: callsign,
      angle: 0, // Add angle property to store current direction
      x: startX, // Use floating point for smoother movement
      y: startY,
      element: document.createElement("div"),
      waypoints: [], // Array of {x, y} points
      currentWaypointIndex: 0,
      targetRunwayY:
        RUNWAY_START_ROW +
        Math.random() * (RUNWAY_END_ROW - RUNWAY_START_ROW + 1), // Target a random spot on the runway
      state: "flying", // flying, landing, landed, warning, collided
      isSelected: false,
      justCollided: false, // Flag to handle collision event once
    };

    // We no longer add initial runway waypoint - aircraft will only go to the runway if directed

    ac.element.classList.add("aircraft");
    ac.element.textContent = callsign; // Display callsign
    ac.element.dataset.id = ac.id; // Store ID for click handling

    // Create and append the direction arrow element
    const arrowElement = document.createElement("div");
    arrowElement.classList.add("aircraft-arrow");
    ac.element.appendChild(arrowElement); // Append arrow to aircraft div

    ac.element.addEventListener("click", (event) => {
      event.stopPropagation(); // Prevent grid click when clicking plane
      handleAircraftClick(ac);
    });

    airspaceGrid.appendChild(ac.element);
    aircraft.push(ac);

    // If no waypoints, aircraft will hover in place until directed
    updateAircraftElementPosition(ac); // Initial position and arrow rotation
    logMessage(
      `Aircraft ${ac.callsign} spawned at (${ac.x.toFixed(1)}, ${ac.y.toFixed(
        1
      )}). Awaiting directions.`
    );
  }

  // --- Aircraft Movement & Logic ---
  function updateAircraftElementPosition(ac) {
    ac.element.style.left = `${ac.x * CELL_SIZE}px`;
    ac.element.style.top = `${ac.y * CELL_SIZE}px`;
    // Center the dot on the grid point using translate
    ac.element.style.transform = `translate(-50%, -50%)`;

    // Update arrow rotation
    const arrowElement = ac.element.querySelector(".aircraft-arrow");
    if (arrowElement) {
      // The arrow's own transform rotates it, its parent's translate positions the whole thing
      arrowElement.style.transform = `translateY(-50%) rotate(${ac.angle}rad)`;
    }

    // Update visual state classes
    ac.element.classList.toggle("selected", ac.isSelected);
    ac.element.classList.toggle("warning", ac.state === "warning");
    ac.element.classList.toggle("collided", ac.state === "collided");
    if (ac.state !== "collided") {
      ac.element.style.animation = "none"; // Stop blinking if not collided
    } else if (
      !ac.element.style.animationName ||
      ac.element.style.animationName === "none"
    ) {
      ac.element.style.animation = "blink 0.5s infinite alternate"; // Start blinking if collided
    }
  }

  function moveAircraft(ac, deltaTime) {
    if (ac.state !== "flying" && ac.state !== "warning") return; // Don't move if landed, collided etc.
    if (
      ac.waypoints.length === 0 ||
      ac.currentWaypointIndex >= ac.waypoints.length
    )
      return; // No target

    const targetWaypoint = ac.waypoints[ac.currentWaypointIndex];
    const targetX = targetWaypoint.x;
    const targetY = targetWaypoint.y;

    const dx = targetX - ac.x;
    const dy = targetY - ac.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let moveAngle = ac.angle; // Keep previous angle if not moving

    const moveDistance = tilesPerSecond * deltaTime;

    if (distance < moveDistance || distance < 0.1) {
      // Reached waypoint or very close
      ac.x = targetX;
      ac.y = targetY;
      ac.currentWaypointIndex++; // Move to next waypoint

      // Check if the reached waypoint is the runway
      if (
        ac.x >= RUNWAY_COL &&
        ac.y >= RUNWAY_START_ROW &&
        ac.y <= RUNWAY_END_ROW &&
        ac.currentWaypointIndex >= ac.waypoints.length
      ) {
        handleLanding(ac);
      } else if (ac.currentWaypointIndex < ac.waypoints.length) {
        // Set angle towards the *new* next waypoint
        const nextTargetWaypoint = ac.waypoints[ac.currentWaypointIndex];
        const nextDx = nextTargetWaypoint.x - ac.x;
        const nextDy = nextTargetWaypoint.y - ac.y;
        if (nextDx !== 0 || nextDy !== 0) {
          // Avoid NaN if already at next waypoint
          moveAngle = Math.atan2(nextDy, nextDx);
        }
      }
    } else {
      // Move towards waypoint
      ac.x += (dx / distance) * moveDistance;
      ac.y += (dy / distance) * moveDistance;
      // Calculate angle for the arrow based on current movement
      moveAngle = Math.atan2(dy, dx); // Calculate angle in radians
    }
    ac.angle = moveAngle; // Store the calculated angle
  }

  function handleLanding(ac) {
    if (ac.state === "landed") return; // Already landed
    ac.state = "landed";
    logMessage(`Aircraft ${ac.callsign} landed successfully.`);
    landedCount++;
    ac.element.remove(); // Remove from display
    // Remove from active aircraft array
    aircraft = aircraft.filter((plane) => plane.id !== ac.id);
    if (selectedAircraft && selectedAircraft.id === ac.id) {
      selectedAircraft = null; // Deselect if landed
    }
  }

  // --- Collision Detection ---
  function checkCollisions() {
    let collisionOccurred = false;
    // Reset warning state for all non-collided planes first
    aircraft.forEach((ac) => {
      if (ac.state === "warning") {
        ac.state = "flying";
      }
      // Reset justCollided flag only if state is not collided
      if (ac.state !== "collided") {
        ac.justCollided = false;
      }
    });

    for (let i = 0; i < aircraft.length; i++) {
      if (aircraft[i].state === "landed" || aircraft[i].state === "collided")
        continue;

      for (let j = i + 1; j < aircraft.length; j++) {
        if (aircraft[j].state === "landed" || aircraft[j].state === "collided")
          continue;

        const ac1 = aircraft[i];
        const ac2 = aircraft[j];

        const dx = ac1.x - ac2.x;
        const dy = ac1.y - ac2.y;
        const distanceSquared = dx * dx + dy * dy;

        // Check for direct collision (closer than ~1 tile)
        if (distanceSquared < 1.0) {
          // Check if this specific pair hasn't just been marked as collided in this loop iteration
          if (!ac1.justCollided && !ac2.justCollided) {
            ac1.state = "collided";
            ac2.state = "collided";
            ac1.justCollided = true; // Mark them so they don't trigger another collision count immediately
            ac2.justCollided = true;
            collisionCount++;
            collisionOccurred = true;
            logMessage(
              `CRITICAL: Collision between ${ac1.callsign} and ${ac2.callsign}!`
            );
            // Optional: Game Over on first collision
            // isGameOver = true;
            // logMessage("Game Over due to collision.");
          }
        }
        // Check for proximity warning (within safe distance, but not collided yet)
        else if (distanceSquared < SAFE_DISTANCE_SQUARED) {
          if (ac1.state === "flying") ac1.state = "warning";
          if (ac2.state === "flying") ac2.state = "warning";
          // Avoid spamming log with warnings - maybe only log once per pair?
          // For simplicity, we log every time they are close for now.
          // logMessage(`WARN: Proximity alert between ${ac1.callsign} and ${ac2.callsign}.`);
        }
      }
    }
    return collisionOccurred;
  }

  // --- User Interaction ---
  function handleAircraftClick(clickedAc) {
    if (clickedAc.state === "collided" || clickedAc.state === "landed") return; // Can't select collided/landed planes

    // Deselect previous aircraft if different
    if (selectedAircraft && selectedAircraft.id !== clickedAc.id) {
      selectedAircraft.isSelected = false;
      updateAircraftElementPosition(selectedAircraft); // Update style of previously selected
    }

    // Toggle selection state of the clicked aircraft
    clickedAc.isSelected = !clickedAc.isSelected;

    if (clickedAc.isSelected) {
      selectedAircraft = clickedAc;
      logMessage(
        `Aircraft ${clickedAc.callsign} selected. Click grid for next waypoint.`
      );
    } else {
      selectedAircraft = null; // Deselected
      logMessage(`Aircraft ${clickedAc.callsign} deselected.`);
    }

    updateAircraftElementPosition(clickedAc); // Update style of the clicked aircraft
  }

  function handleGridClick(event) {
    if (
      !selectedAircraft ||
      selectedAircraft.state === "collided" ||
      selectedAircraft.state === "landed"
    ) {
      // If clicking grid without a valid selection, deselect any visually selected plane
      if (selectedAircraft) {
        selectedAircraft.isSelected = false;
        updateAircraftElementPosition(selectedAircraft);
        selectedAircraft = null;
      }
      return;
    }

    const rect = airspaceGrid.getBoundingClientRect();
    // Calculate click coordinates relative to the grid, converting pixels to grid units
    const clickX = (event.clientX - rect.left) / CELL_SIZE;
    const clickY = (event.clientY - rect.top) / CELL_SIZE;

    // Clamp coordinates to be within grid boundaries (allow clicking near edge)
    const targetX = Math.max(0, Math.min(GRID_SIZE - 0.01, clickX));
    const targetY = Math.max(0, Math.min(GRID_SIZE - 0.01, clickY));

    // Create the new waypoint
    const newWaypoint = { x: targetX, y: targetY };

    // Clear existing waypoints *after* the one the plane is currently heading towards
    selectedAircraft.waypoints = selectedAircraft.waypoints.slice(
      0,
      selectedAircraft.currentWaypointIndex + 1
    );
    selectedAircraft.waypoints.push(newWaypoint);

    // Check if the user clicked on the runway
    const isOnRunway =
      targetX >= RUNWAY_COL &&
      targetY >= RUNWAY_START_ROW &&
      targetY <= RUNWAY_END_ROW;

    if (isOnRunway) {
      logMessage(
        `${selectedAircraft.callsign} directed to land at (${targetX.toFixed(
          1
        )}, ${targetY.toFixed(1)}).`
      );
    } else {
      logMessage(
        `New waypoint set for ${
          selectedAircraft.callsign
        } at (${targetX.toFixed(1)}, ${targetY.toFixed(1)}).`
      );
    }

    // Immediately update the plane's angle to point towards the new waypoint
    const dx = newWaypoint.x - selectedAircraft.x;
    const dy = newWaypoint.y - selectedAircraft.y;
    if (dx !== 0 || dy !== 0) {
      // Avoid NaN if clicking current location
      selectedAircraft.angle = Math.atan2(dy, dx);
    }

    updateAircraftElementPosition(selectedAircraft); // Update visuals immediately

    // Keep the aircraft selected after setting a waypoint
    // If you want to deselect after setting:
    // selectedAircraft.isSelected = false;
    // updateAircraftElementPosition(selectedAircraft);
    // selectedAircraft = null;
  }

  // --- Game Loop ---
  function gameLoop() {
    if (isGameOver) {
      stopGameLoop();
      stopSpawning();
      // Find any aircraft that collided and ensure their animation persists
      aircraft.forEach((ac) => {
        if (ac.state === "collided") updateAircraftElementPosition(ac);
      });
      logMessage("Game loop stopped.");
      return;
    }

    const deltaTime = UPDATE_INTERVAL_MS / 1000.0; // Delta time in seconds

    // 1. Move Aircraft
    aircraft.forEach((ac) => moveAircraft(ac, deltaTime));

    // 2. Check for Collisions
    checkCollisions(); // This function now also handles setting the 'collided' state

    // 3. Update Aircraft Visuals (Position and State Styling)
    aircraft.forEach(updateAircraftElementPosition);

    // 4. Update Status Display
    updateStatusDisplay();
  }

  function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval); // Clear existing interval if any
    gameInterval = setInterval(gameLoop, UPDATE_INTERVAL_MS);
    logMessage("Game loop started.");
  }

  function stopGameLoop() {
    clearInterval(gameInterval);
    gameInterval = null;
  }

  // --- Spawning Control ---
  function startSpawning() {
    stopSpawning(); // Clear existing interval first
    const ratePerMin = parseInt(spawnRateSlider.value);
    if (ratePerMin > 0 && !isGameOver) {
      // Don't spawn if game over
      const intervalMs = (60 / ratePerMin) * 1000;
      spawnInterval = setInterval(createAircraft, intervalMs);
      logMessage(
        `Spawning aircraft every ${(intervalMs / 1000).toFixed(1)} seconds.`
      );
    } else if (ratePerMin === 0) {
      logMessage(`Spawning paused (rate set to 0).`);
    }
  }

  function stopSpawning() {
    clearInterval(spawnInterval);
    spawnInterval = null;
  }

  // --- UI Updates ---
  function updateStatusDisplay() {
    const activePlanes = aircraft.filter(
      (ac) => ac.state !== "landed" && ac.state !== "collided"
    ).length;
    activeAircraftDisplay.textContent = activePlanes;
    landedAircraftDisplay.textContent = landedCount;
    collisionsDisplay.textContent = collisionCount;
    // Update collision display style if there are collisions
    collisionsDisplay.style.color = collisionCount > 0 ? "#ff0000" : "#00ff00";
    collisionsDisplay.style.fontWeight = collisionCount > 0 ? "bold" : "normal";
  }

  // --- Event Listeners ---
  speedSlider.addEventListener("input", (e) => {
    tilesPerSecond = parseFloat(e.target.value);
    speedValueDisplay.textContent = tilesPerSecond.toFixed(1);
  });

  spawnRateSlider.addEventListener("input", (e) => {
    const rate = parseInt(e.target.value);
    spawnRateValueDisplay.textContent = rate;
    // Restart spawner with the new rate (will handle 0 rate correctly)
    startSpawning();
  });

  resetButton.addEventListener("click", resetSimulation);

  // --- Start Simulation ---
  setupGrid();
  startSpawning();
  startGameLoop();
  updateStatusDisplay(); // Initial display
  // Display initial settings in log
  logMessage(`Initial speed set to ${tilesPerSecond.toFixed(1)} tiles/sec.`);
  logMessage(`Initial spawn rate set to ${spawnRateSlider.value} planes/min.`);
});
