document.addEventListener("DOMContentLoaded", () => {
  // --- Configuration ---
  const GRID_SIZE = 30; // Number of cells horizontally and vertically
  const CELL_SIZE = 20; // Size of each cell in pixels

  // Move runway to center
  const RUNWAY_COL = Math.floor(GRID_SIZE / 2);
  const RUNWAY_START_ROW = Math.floor(GRID_SIZE / 2) - 1;
  const RUNWAY_END_ROW = Math.floor(GRID_SIZE / 2) + 1;

  // Landing detection radius around runway
  const LANDING_RADIUS = 1;

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

    // Add Runway (now in center)
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

    logMessage("Grid initialized. Runway positioned in center.");
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
    const edge = Math.floor(Math.random() * 4); // 0: left, 1: top, 2: bottom, 3: right

    if (edge === 0) {
      // Left edge
      startX = 0;
      startY = Math.random() * GRID_SIZE;
    } else if (edge === 1) {
      // Top edge
      startX = Math.random() * GRID_SIZE;
      startY = 0;
    } else if (edge === 2) {
      // Bottom edge
      startX = Math.random() * GRID_SIZE;
      startY = GRID_SIZE - 1;
    } else {
      // Right edge
      startX = GRID_SIZE - 1;
      startY = Math.random() * GRID_SIZE;
    }

    // Set a random initial direction in linear path
    const randomAngle = Math.random() * 2 * Math.PI; // Random angle in radians

    const ac = {
      id: aircraftCounter,
      callsign: callsign,
      angle: randomAngle, // Random initial angle
      x: startX, // Use floating point for smoother movement
      y: startY,
      element: document.createElement("div"),
      waypoints: [], // Array of {x, y} points
      currentWaypointIndex: 0,
      targetRunwayY: RUNWAY_START_ROW + 1, // Middle of runway
      state: "flying", // flying, landing, landed, warning, collided
      isSelected: false,
      justCollided: false, // Flag to handle collision event once
      linearMode: true, // New flag to indicate aircraft is flying in a linear path
      linearVector: {
        // Vector to represent linear path direction
        dx: Math.cos(randomAngle),
        dy: Math.sin(randomAngle),
      },
    };

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

    updateAircraftElementPosition(ac); // Initial position and arrow rotation
    logMessage(
      `Aircraft ${ac.callsign} spawned at (${ac.x.toFixed(1)}, ${ac.y.toFixed(
        1
      )}) with heading ${Math.round((ac.angle * 180) / Math.PI)}°`
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

    const moveDistance = tilesPerSecond * deltaTime;

    // Check if aircraft has waypoints to follow
    if (
      ac.waypoints.length > 0 &&
      ac.currentWaypointIndex < ac.waypoints.length
    ) {
      // Waypoint mode
      const targetWaypoint = ac.waypoints[ac.currentWaypointIndex];
      const targetX = targetWaypoint.x;
      const targetY = targetWaypoint.y;

      const dx = targetX - ac.x;
      const dy = targetY - ac.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < moveDistance || distance < 0.1) {
        // Reached waypoint or very close
        ac.x = targetX;
        ac.y = targetY;
        ac.currentWaypointIndex++; // Move to next waypoint

        // If no more waypoints, switch to linear mode with current angle
        if (ac.currentWaypointIndex >= ac.waypoints.length) {
          ac.linearMode = true;
          ac.linearVector = {
            dx: Math.cos(ac.angle),
            dy: Math.sin(ac.angle),
          };
          logMessage(
            `${ac.callsign} reached final waypoint. Continuing on linear path.`
          );
        } else {
          // Set angle towards the next waypoint
          const nextTargetWaypoint = ac.waypoints[ac.currentWaypointIndex];
          const nextDx = nextTargetWaypoint.x - ac.x;
          const nextDy = nextTargetWaypoint.y - ac.y;
          if (nextDx !== 0 || nextDy !== 0) {
            // Avoid NaN if already at next waypoint
            ac.angle = Math.atan2(nextDy, nextDx);
          }
        }
      } else {
        // Move towards waypoint
        ac.x += (dx / distance) * moveDistance;
        ac.y += (dy / distance) * moveDistance;
        // Calculate angle for the arrow based on current movement
        ac.angle = Math.atan2(dy, dx); // Calculate angle in radians
      }
    } else if (ac.linearMode) {
      // Linear mode - continue in straight line
      ac.x += ac.linearVector.dx * moveDistance;
      ac.y += ac.linearVector.dy * moveDistance;

      // Handle out of bounds by bouncing off edges to keep them in game area
      if (ac.x < 0) {
        ac.x = 0;
        ac.linearVector.dx *= -1;
        ac.angle = Math.atan2(ac.linearVector.dy, ac.linearVector.dx);
      } else if (ac.x >= GRID_SIZE) {
        ac.x = GRID_SIZE - 0.01;
        ac.linearVector.dx *= -1;
        ac.angle = Math.atan2(ac.linearVector.dy, ac.linearVector.dx);
      }

      if (ac.y < 0) {
        ac.y = 0;
        ac.linearVector.dy *= -1;
        ac.angle = Math.atan2(ac.linearVector.dy, ac.linearVector.dx);
      } else if (ac.y >= GRID_SIZE) {
        ac.y = GRID_SIZE - 0.01;
        ac.linearVector.dy *= -1;
        ac.angle = Math.atan2(ac.linearVector.dy, ac.linearVector.dx);
      }
    }

    // Check for landing (now using radius detection around runway)
    checkForLanding(ac);
  }

  function checkForLanding(ac) {
    // Is the aircraft near the runway?
    const runwayX = RUNWAY_COL;
    const runwayYMiddle = (RUNWAY_START_ROW + RUNWAY_END_ROW) / 2;

    const dx = ac.x - runwayX;
    const dy = ac.y - runwayYMiddle;
    const distanceSquared = dx * dx + dy * dy;

    // Check if aircraft is within landing radius of runway and between runway start/end
    const inLandingZone =
      ac.y >= RUNWAY_START_ROW - LANDING_RADIUS &&
      ac.y <= RUNWAY_END_ROW + LANDING_RADIUS;

    // Use the squared distance for efficiency
    const landingRadiusSquared = LANDING_RADIUS * LANDING_RADIUS;

    if (inLandingZone && distanceSquared <= landingRadiusSquared) {
      handleLanding(ac);
    }
  }

  function handleLanding(ac) {
    if (ac.state === "landed") return; // Already landed
    ac.state = "landed";
    logMessage(`Aircraft ${ac.callsign} landed successfully at runway.`);
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
        `Aircraft ${clickedAc.callsign} selected. Click grid for waypoint.`
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

    // Switch to waypoint mode and clear any previous waypoints
    selectedAircraft.linearMode = false;
    selectedAircraft.waypoints = [newWaypoint];
    selectedAircraft.currentWaypointIndex = 0;

    // Check if the user clicked on/near the runway
    const isNearRunway =
      Math.abs(targetX - RUNWAY_COL) <= LANDING_RADIUS &&
      targetY >= RUNWAY_START_ROW - LANDING_RADIUS &&
      targetY <= RUNWAY_END_ROW + LANDING_RADIUS;

    if (isNearRunway) {
      logMessage(
        `${
          selectedAircraft.callsign
        } directed toward runway at (${targetX.toFixed(1)}, ${targetY.toFixed(
          1
        )}).`
      );
    } else {
      logMessage(
        `${selectedAircraft.callsign} directed to (${targetX.toFixed(
          1
        )}, ${targetY.toFixed(1)}).`
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
  logMessage(`Runway positioned in center of airspace.`);
});
