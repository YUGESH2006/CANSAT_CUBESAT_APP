/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { 
  Play, 
  Square, 
  Download, 
  RotateCcw, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle, 
  Video, 
  MapPin, 
  Radio, 
  Wifi, 
  Database, 
  Activity, 
  RefreshCw, 
  Compass, 
  Clock, 
  Cpu, 
  Battery, 
  TrendingDown, 
  Thermometer, 
  Gauge
} from 'lucide-react';

// Declare types for CDN window imports
declare global {
  interface Window {
    Chart: any;
    L: any;
    THREE: any;
  }
}

// Telemetry Packet Interface
interface TelemetryPacket {
  teamId: string;
  packetCount: number;
  altitude: number;
  pressure: number;
  temperature: number;
  descentRate: number;
  voltage: number;
  latitude: number;
  longitude: number;
  roll: number;
  pitch: number;
  yaw: number;
  errorCode: string; // 4-digit binary string, e.g., "0100"
  timestamp: string; // ISO string
  raw: string;
}

// System Log Interface
interface SystemLog {
  id: string;
  timestamp: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'COMMAND';
  message: string;
}

export default function App() {
  // Connection and Mode States
  const [serialConnected, setSerialConnected] = useState<boolean>(false);
  const [simulationActive, setSimulationActive] = useState<boolean>(false);
  const [streamActive, setStreamActive] = useState<boolean>(false);
  
  // Simulation Flight State
  const [simPhase, setSimPhase] = useState<'LAUNCHPAD' | 'ASCENDING' | 'DESCENT' | 'LANDED'>('LAUNCHPAD');
  const [simTime, setSimTime] = useState<number>(0);
  
  // Custom Team ID input
  const [teamId, setTeamId] = useState<string>("ISL_TEAM_2026");
  
  // Telemetry Packet Counts
  const [packets, setPackets] = useState<TelemetryPacket[]>([]);
  const [corruptedPacketsCount, setCorruptedPacketsCount] = useState<number>(0);
  const [lastPacket, setLastPacket] = useState<TelemetryPacket | null>(null);

  // Command verification slider state
  const [separationConfirmVal, setSeparationConfirmVal] = useState<number>(0);
  const [commandStatus, setCommandStatus] = useState<string>("SYSTEMS IDLE");

  // Console Logs
  const [logs, setLogs] = useState<SystemLog[]>([]);

  // Camera States
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [cameraStreamActive, setCameraStreamActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>("");

  // Fault Injection States (for the simulator)
  const [faultDescentRate, setFaultDescentRate] = useState<boolean>(false);
  const [faultGPSLoss, setFaultGPSLoss] = useState<boolean>(false);
  const [faultSepFailure, setFaultSepFailure] = useState<boolean>(false);
  const [faultChuteFailure, setFaultChuteFailure] = useState<boolean>(false);

  // Clock
  const [utcTime, setUtcTime] = useState<string>("");

  // Refs for Imperative DOM and Third-Party instances
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const serialPortRef = useRef<any>(null);
  const serialReaderRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  
  // Chart Refs
  const chartsRef = useRef<{ [key: string]: any }>({});
  const canvasRefs = {
    altitude: useRef<HTMLCanvasElement>(null),
    pressure: useRef<HTMLCanvasElement>(null),
    temperature: useRef<HTMLCanvasElement>(null),
    descentRate: useRef<HTMLCanvasElement>(null),
    voltage: useRef<HTMLCanvasElement>(null),
  };

  // Map and 3D Visualizer Refs
  const mapRef = useRef<any>(null);
  const pathRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const cansatMeshRef = useRef<any>(null);

  // Full accumulative log for CSV export
  const allParsedPacketsRef = useRef<TelemetryPacket[]>([]);

  // 1. Live UTC Clock Update
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setUtcTime(now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // 2. Logging Utility
  const logMessage = (type: SystemLog['type'], message: string) => {
    const newLog: SystemLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString().substring(11, 19),
      type,
      message
    };
    setLogs(prev => {
      const updated = [...prev, newLog];
      return updated.slice(-100); // Limit UI logs to last 100
    });
  };

  // Auto scroll terminal logs to bottom
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // 3. Web Camera Device Enumeration
  useEffect(() => {
    const getDevices = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          throw new Error("MediaDevices API unsupported");
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setCameraDevices(videoDevices);
        if (videoDevices.length > 0) {
          setSelectedCameraId(videoDevices[0].deviceId);
        }
      } catch (e: any) {
        setCameraError("Camera access unsupported/blocked inside iframe");
        logMessage("WARNING", `Media devices discovery blocked: ${e.message}`);
      }
    };
    getDevices();
  }, []);

  // Camera stream activation handler
  const toggleCameraStream = async () => {
    if (cameraStreamActive) {
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach(t => t.stop());
        activeStreamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setCameraStreamActive(false);
      logMessage("INFO", "Camera feed deactivated");
    } else {
      try {
        const constraints = {
          video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
          audio: false
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.error("Play video failed:", e));
        }
        activeStreamRef.current = stream;
        setCameraStreamActive(true);
        setCameraError("");
        logMessage("SUCCESS", "Camera streaming activated");
      } catch (e: any) {
        console.error("Camera capture failed", e);
        setCameraError("Failed to lock selected camera (Iframe Permissions or Busy)");
        logMessage("ERROR", `Camera acquisition error: ${e.message}`);
      }
    }
  };

  // 4. Initialize Five Line Charts with Chart.js
  useEffect(() => {
    if (!window.Chart) {
      logMessage("ERROR", "Chart.js was not loaded properly from CDN.");
      return;
    }

    const initSingleChart = (ref: React.RefObject<HTMLCanvasElement | null>, field: string, label: string, color: string, min?: number, max?: number) => {
      const canvas = ref.current;
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // Ensure no previous instances persist
      if (chartsRef.current[field]) {
        chartsRef.current[field].destroy();
      }

      chartsRef.current[field] = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels: Array(50).fill(''),
          datasets: [{
            label: label,
            data: Array(50).fill(null),
            borderColor: color,
            borderWidth: 1.5,
            backgroundColor: `${color}10`,
            tension: 0.15,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false, // Turn off layout animations for fast real-time updates
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
          },
          scales: {
            x: {
              grid: { color: '#1e2433' },
              ticks: { display: false }
            },
            y: {
              grid: { color: '#1e2433' },
              ticks: { 
                color: '#8e9bb4', 
                font: { size: 9, family: 'JetBrains Mono' } 
              },
              min,
              max
            }
          }
        }
      });
    };

    initSingleChart(canvasRefs.altitude, 'altitude', 'Altitude (m)', '#00f2ff', 0, 850);
    initSingleChart(canvasRefs.pressure, 'pressure', 'Pressure (Pa)', '#10b981', 0, 110000);
    initSingleChart(canvasRefs.temperature, 'temperature', 'Temperature (°C)', '#f59e0b', -10, 40);
    initSingleChart(canvasRefs.descentRate, 'descentRate', 'Descent Rate (m/s)', '#ef4444', -5, 25);
    initSingleChart(canvasRefs.voltage, 'voltage', 'Voltage (V)', '#a855f7', 2.5, 4.5);

    logMessage("INFO", "Analytical Chart grids initialized");

    return () => {
      Object.keys(chartsRef.current).forEach(key => {
        if (chartsRef.current[key]) {
          chartsRef.current[key].destroy();
        }
      });
    };
  }, []);

  // Update chart data series on new packet
  const pushChartData = (packet: TelemetryPacket) => {
    const fields = ['altitude', 'pressure', 'temperature', 'descentRate', 'voltage'];
    fields.forEach(field => {
      const chartInstance = chartsRef.current[field];
      if (!chartInstance) return;

      const dataset = chartInstance.data.datasets[0];
      const labels = chartInstance.data.labels;
      const packetVal = packet[field as keyof TelemetryPacket] as number;

      // Shift arrays to keep 50 points rolling ceiling
      dataset.data.push(packetVal);
      labels.push(new Date(packet.timestamp).toLocaleTimeString([], { hour12: false }));

      if (dataset.data.length > 50) {
        dataset.data.shift();
        labels.shift();
      }

      chartInstance.update('none'); // Update immediately without full visual redraw block
    });
  };

  // 5. Initialize Leaflet Tracking Map
  useEffect(() => {
    if (!window.L) {
      logMessage("ERROR", "Leaflet mapping engine unavailable.");
      return;
    }

    // Default coordinate: Janakpuri, New Delhi
    const defaultCoords = [28.6219, 77.0878];

    // Initialize Leaflet map
    const map = window.L.map('map-canvas', {
      zoomControl: false,
      attributionControl: false
    }).setView(defaultCoords, 16);

    // Zoom control at bottom right to stay clean
    window.L.control.zoom({ position: 'topright' }).addTo(map);

    // Add CartoDB Dark Matter map layers (perfect match for Ground Control visual aesthetics)
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    // Dynamic flight trajectory line
    const flightPath = window.L.polyline([], {
      color: '#00f2ff',
      weight: 3.5,
      opacity: 0.9,
      lineCap: 'round'
    }).addTo(map);

    // Custom aerospace landing pad target indicator
    const targetIcon = window.L.divIcon({
      className: 'gcs-target-pad',
      html: `
        <div style="position: relative; width: 24px; height: 24px; transform: translate(-6px, -6px);">
          <div style="position: absolute; width: 100%; height: 100%; border: 2px solid #f59e0b; border-radius: 50%; opacity: 0.5;"></div>
          <div style="position: absolute; top: 10px; left: 10px; width: 4px; height: 4px; background: #f59e0b; border-radius: 50%;"></div>
        </div>
      `,
      iconSize: [24, 24]
    });
    window.L.marker(defaultCoords, { icon: targetIcon }).addTo(map);

    // Pulsing CanSat current position marker
    const satIcon = window.L.divIcon({
      className: 'gcs-sat-marker',
      html: `
        <div style="position: relative; width: 16px; height: 16px;">
          <div style="position: absolute; width: 100%; height: 100%; background: #00f2ff; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 12px #00f2ff; animation: pulse 1s infinite alternate;"></div>
        </div>
      `,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const currentMarker = window.L.marker(defaultCoords, { icon: satIcon }).addTo(map);
    currentMarker.bindPopup('<b style="color:#080b11">Telemetry GPS Lock</b>').openPopup();

    mapRef.current = map;
    pathRef.current = flightPath;
    markerRef.current = currentMarker;

    logMessage("INFO", "Map telemetry coordinate tracker online");

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update map coordinates
  const pushMapData = (lat: number, lon: number) => {
    if (!mapRef.current || !pathRef.current || !markerRef.current) return;
    
    // Check for bad default coordinates
    if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) return;

    const latlng = [lat, lon];
    markerRef.current.setLatLng(latlng);
    pathRef.current.addLatLng(latlng);
    
    // Auto shift view window to current telemetry coordinates
    mapRef.current.panTo(latlng);
  };

  // 6. Initialize Three.js 3D Orientation Model
  useEffect(() => {
    if (!window.THREE) {
      logMessage("ERROR", "Three.js visual core not loaded.");
      return;
    }

    const container = document.getElementById('canvas-3d');
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // WebGL Scene
    const scene = new window.THREE.Scene();
    scene.background = new window.THREE.Color('#070a13');

    // Camera
    const camera = new window.THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(0, 0.5, 6);

    // Renderer
    const renderer = new window.THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.innerHTML = ''; // Clean container
    container.appendChild(renderer.domElement);

    // Grid Floor
    const gridHelper = new window.THREE.GridHelper(8, 16, '#18243e', '#0f172a');
    gridHelper.position.y = -1.8;
    scene.add(gridHelper);

    // Lights
    const ambientLight = new window.THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight = new window.THREE.DirectionalLight(0xffffff, 0.95);
    dirLight.position.set(5, 8, 5);
    scene.add(dirLight);

    const pointLight = new window.THREE.PointLight(0x00f0ff, 1.2, 10);
    pointLight.position.set(-2, 1, 2);
    scene.add(pointLight);

    // CanSat Group Container
    const cansatGroup = new window.THREE.Group();

    // Cylindrical CanSat body (Container Shell)
    const bodyGeometry = new window.THREE.CylinderGeometry(1.0, 1.0, 2.3, 32);
    const bodyMaterial = new window.THREE.MeshStandardMaterial({
      color: 0x1b2336,
      metalness: 0.85,
      roughness: 0.35,
      transparent: true,
      opacity: 0.95
    });

    const cylinderMesh = new window.THREE.Mesh(bodyGeometry, bodyMaterial);
    cansatGroup.add(cylinderMesh);

    // Top and bottom metallic caps
    const capGeometry = new window.THREE.CylinderGeometry(1.05, 1.05, 0.15, 32);
    const capMaterial = new window.THREE.MeshStandardMaterial({
      color: 0xb2bec3,
      metalness: 0.95,
      roughness: 0.15
    });

    const topCap = new window.THREE.Mesh(capGeometry, capMaterial);
    topCap.position.y = 1.15;
    const bottomCap = new window.THREE.Mesh(capGeometry, capMaterial);
    bottomCap.position.y = -1.15;

    cansatGroup.add(topCap);
    cansatGroup.add(bottomCap);

    // Antenna wire
    const antennaGeom = new window.THREE.CylinderGeometry(0.02, 0.02, 1.2, 8);
    const antennaMat = new window.THREE.MeshStandardMaterial({ color: 0x00f0ff, metalness: 0.9 });
    const antenna = new window.THREE.Mesh(antennaGeom, antennaMat);
    antenna.position.y = -1.75;
    cansatGroup.add(antenna);

    // Lateral Solar Panels/Fins (4 structural wings)
    const finGeom = new window.THREE.BoxGeometry(0.08, 1.4, 0.5);
    const finMat = new window.THREE.MeshStandardMaterial({
      color: 0x011e41, // Solar cell dark indigo
      roughness: 0.2,
      metalness: 0.9
    });

    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const fin = new window.THREE.Mesh(finGeom, finMat);
      fin.position.set(Math.cos(angle) * 1.15, 0, Math.sin(angle) * 1.15);
      fin.rotation.y = -angle;
      cansatGroup.add(fin);
    }

    // Directional visual chevron to clearly see Yaw orientation (Top Red cone)
    const noseGeom = new window.THREE.ConeGeometry(0.8, 0.5, 16);
    const noseMat = new window.THREE.MeshStandardMaterial({ color: 0xff3366, roughness: 0.4 });
    const nose = new window.THREE.Mesh(noseGeom, noseMat);
    nose.position.y = 1.4;
    cansatGroup.add(nose);

    scene.add(cansatGroup);

    // Compass Vector Helpers (XYZ axes)
    const axesHelper = new window.THREE.AxesHelper(1.8);
    axesHelper.position.set(0, 0, 0);
    scene.add(axesHelper);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    cansatMeshRef.current = cansatGroup;

    // Render Animation Loop
    let animationId: number;
    const renderLoop = () => {
      animationId = requestAnimationFrame(renderLoop);
      renderer.render(scene, camera);
    };
    renderLoop();

    // Auto fit WebGL canvas on grid/div changes
    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    logMessage("INFO", "3D Gyro orientation system active");

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update 3D model orientation angles
  const pushOrientationData = (roll: number, pitch: number, yaw: number) => {
    if (!cansatMeshRef.current) return;
    
    // Euler angles in radians
    const r = (roll * Math.PI) / 180;
    const p = (pitch * Math.PI) / 180;
    const y = (yaw * Math.PI) / 180;

    // Apply Tait-Bryan aerospace rotations (YXZ)
    cansatMeshRef.current.rotation.set(p, y, r);
  };

  // 7. Core Parser & Defensive Validator
  const handleIncomingTelemetryLine = (line: string) => {
    const rawLine = line.trim();
    if (!rawLine) return;

    try {
      const parts = rawLine.split(',');

      // Format: TEAM_ID,PACKET_COUNT,ALTITUDE,PRESSURE,TEMPERATURE,DESCENT_RATE,VOLTAGE,LATITUDE,LONGITUDE,ROLL,PITCH,YAW,ERROR_CODE
      if (parts.length < 13) {
        throw new Error(`Insufficient CSV telemetry dimensions. Got ${parts.length} values, required 13.`);
      }

      const parsedPacket: TelemetryPacket = {
        teamId: parts[0].trim(),
        packetCount: parseInt(parts[1].trim(), 10),
        altitude: parseFloat(parts[2].trim()),
        pressure: parseFloat(parts[3].trim()),
        temperature: parseFloat(parts[4].trim()),
        descentRate: parseFloat(parts[5].trim()),
        voltage: parseFloat(parts[6].trim()),
        latitude: parseFloat(parts[7].trim()),
        longitude: parseFloat(parts[8].trim()),
        roll: parseFloat(parts[9].trim()),
        pitch: parseFloat(parts[10].trim()),
        yaw: parseFloat(parts[11].trim()),
        errorCode: parts[12].trim().substring(0, 4),
        timestamp: new Date().toISOString(),
        raw: rawLine
      };

      // Defensive Verification: Check for NaN in all critical numerical fields
      const isCorrupted = 
        isNaN(parsedPacket.packetCount) ||
        isNaN(parsedPacket.altitude) ||
        isNaN(parsedPacket.pressure) ||
        isNaN(parsedPacket.temperature) ||
        isNaN(parsedPacket.descentRate) ||
        isNaN(parsedPacket.voltage) ||
        isNaN(parsedPacket.latitude) ||
        isNaN(parsedPacket.longitude) ||
        isNaN(parsedPacket.roll) ||
        isNaN(parsedPacket.pitch) ||
        isNaN(parsedPacket.yaw) ||
        !/^[01]{4}$/.test(parsedPacket.errorCode);

      if (isCorrupted) {
        throw new Error("One or more critical fields contain NaN data or incorrect binary error bits.");
      }

      // Successful Parse! Update UI state.
      setLastPacket(parsedPacket);
      setPackets(prev => {
        const next = [...prev, parsedPacket];
        return next.slice(-100); // UI performance window (keeps last 100 in state)
      });

      // Maintain full export log
      allParsedPacketsRef.current.push(parsedPacket);

      // Distribute parsed updates to Charts, Map, and 3D visualizers
      pushChartData(parsedPacket);
      pushMapData(parsedPacket.latitude, parsedPacket.longitude);
      pushOrientationData(parsedPacket.roll, parsedPacket.pitch, parsedPacket.yaw);

    } catch (e: any) {
      setCorruptedPacketsCount(prev => prev + 1);
      logMessage("ERROR", `Defensive Parse Fault: ${e.message}`);
    }
  };

  // 8. Flight Path Simulator Generation
  useEffect(() => {
    if (!simulationActive) return;

    logMessage("INFO", `Activated Flight Simulation mode. Generating telemetry for Team: ${teamId}`);
    setCommandStatus("SIMULATOR READY");

    const simInterval = setInterval(() => {
      setSimTime(prevTime => {
        const nextTime = prevTime + 1;
        
        // Sim State Transitions
        let phase = simPhase;
        if (nextTime < 10) phase = 'LAUNCHPAD';
        else if (nextTime < 30) phase = 'ASCENDING';
        else if (nextTime < 80) phase = 'DESCENT';
        else phase = 'LANDED';

        if (phase !== simPhase) {
          setSimPhase(phase);
          logMessage("INFO", `Flight simulator changed state to: [${phase}]`);
        }

        // Base flight trajectory calculations
        let alt = 0;
        let press = 101325; // Standard Sea Level Pa
        let temp = 24.8;
        let rate = 0;
        let volt = 4.18 - (nextTime * 0.003); // linear decay

        // Coordinates drift starting from India Space Lab
        let lat = 28.6219;
        let lon = 77.0878;

        if (phase === 'ASCENDING') {
          // Accelerate to top peak
          alt = (nextTime - 10) * 37.5; // reaches 750m
          rate = -37.5; // Negative means climbing up
          press = 101325 * Math.pow(1 - 2.25577e-5 * alt, 5.25588);
          temp = 24.8 - (alt * 0.0065);
          // High-G vibrations
          var roll = Math.sin(nextTime * 1.5) * 22;
          var pitch = Math.cos(nextTime * 1.5) * 22;
          var yaw = (nextTime * 18) % 360;
        } else if (phase === 'DESCENT') {
          // Descent rate: default safe rate 8.8 m/s, or corrupted rate if injected
          rate = faultDescentRate ? 14.5 : 8.8; 
          const descentDuration = nextTime - 30;
          alt = 750 - (descentDuration * rate);
          
          if (alt < 0) alt = 0;

          press = 101325 * Math.pow(1 - 2.25577e-5 * alt, 5.25588);
          temp = 24.8 - (alt * 0.0065);

          // Drift latitude and longitude with downwind speed
          lat = 28.6219 + (descentDuration * 0.00002);
          lon = 77.0878 + (descentDuration * 0.000045);

          // Gentle wind turbulence oscillations
          var roll = Math.sin(nextTime * 0.8) * 12;
          var pitch = Math.cos(nextTime * 0.5) * 8;
          var yaw = (nextTime * 4) % 360;
        } else if (phase === 'LANDED') {
          alt = 0;
          press = 101325;
          temp = 25.2;
          rate = 0;
          lat = 28.6219 + (50 * 0.00002);
          lon = 77.0878 + (50 * 0.000045);
          var roll = 0;
          var pitch = 0;
          var yaw = 124.5; // Settled heading
        } else {
          // Prelaunch jitter
          alt = 0;
          rate = 0;
          var roll = Math.sin(nextTime * 0.2) * 0.5;
          var pitch = Math.cos(nextTime * 0.2) * 0.5;
          var yaw = 0;
        }

        // Add small sensor noise jitters to look highly authentic
        const noise = (Math.random() - 0.5);
        alt = Math.max(0, parseFloat((alt + noise * 0.2).toFixed(2)));
        press = Math.max(0, parseFloat((press + noise * 12).toFixed(1)));
        temp = parseFloat((temp + noise * 0.1).toFixed(1));
        rate = parseFloat((rate + noise * 0.05).toFixed(2));
        volt = parseFloat((Math.max(2.8, volt + noise * 0.005)).toFixed(3));

        // Format dynamically updated Error Code based on injected status switches
        const digit1 = (rate > 10.0 || rate < 8.0) && phase === 'DESCENT' ? '1' : '0';
        const digit2 = faultGPSLoss ? '1' : '0';
        const digit3 = faultSepFailure ? '1' : '0';
        const digit4 = faultChuteFailure ? '1' : '0';
        const simErrorCode = `${digit1}${digit2}${digit3}${digit4}`;

        if (digit2 === '1') {
          lat = 0; // Loss of GPS simulation
          lon = 0;
        }

        // Build CSV formatted telemetry string
        const generatedLine = [
          teamId,
          nextTime,
          alt,
          press,
          temp,
          rate,
          volt,
          lat.toFixed(6),
          lon.toFixed(6),
          roll.toFixed(1),
          pitch.toFixed(1),
          yaw.toFixed(1),
          simErrorCode
        ].join(',');

        // Pass directly to the main system parser
        handleIncomingTelemetryLine(generatedLine);

        return nextTime;
      });
    }, 1000);

    return () => clearInterval(simInterval);
  }, [simulationActive, simPhase, teamId, faultDescentRate, faultGPSLoss, faultSepFailure, faultChuteFailure]);

  // 9. Web Serial API Stream Reader
  const connectWebSerial = async () => {
    if (!("serial" in navigator)) {
      logMessage("ERROR", "Web Serial API is unsupported by this browser or nested frame context.");
      alert("Web Serial API is unsupported by this browser. Use simulation mode instead!");
      return;
    }

    try {
      logMessage("INFO", "Opening Web Serial port selection dialog...");
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600 });
      
      serialPortRef.current = port;
      setSerialConnected(true);
      setStreamActive(true);
      logMessage("SUCCESS", "Web Serial port opened at 9600 baud.");

      // Set up streaming text readers
      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      serialReaderRef.current = reader;

      // Disable simulation while active serial is running
      setSimulationActive(false);

      let lineBuffer = "";
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          logMessage("INFO", "Serial stream closed by device.");
          break;
        }
        
        if (value) {
          lineBuffer += value;
          const segments = lineBuffer.split('\n');
          
          // Hold last incomplete segment in buffer
          lineBuffer = segments.pop() || "";

          // Parse and feed complete lines
          for (const line of segments) {
            handleIncomingTelemetryLine(line);
          }
        }
      }

    } catch (e: any) {
      console.error(e);
      setSerialConnected(false);
      setStreamActive(false);
      logMessage("ERROR", `Web Serial connection failed: ${e.message}`);
    }
  };

  const disconnectWebSerial = async () => {
    try {
      if (serialReaderRef.current) {
        await serialReaderRef.current.cancel();
        serialReaderRef.current = null;
      }
      if (serialPortRef.current) {
        await serialPortRef.current.close();
        serialPortRef.current = null;
      }
      setSerialConnected(false);
      setStreamActive(false);
      logMessage("WARNING", "Web Serial port closed manually.");
    } catch (e: any) {
      logMessage("ERROR", `Error closing serial port gracefully: ${e.message}`);
    }
  };

  // 10. Data Management Exporter & Resets
  const exportTelemetryCSV = () => {
    try {
      const savedPackets = allParsedPacketsRef.current;
      if (savedPackets.length === 0) {
        logMessage("WARNING", "CSV Export aborted: Telemetry log is empty.");
        return;
      }

      logMessage("INFO", "Compiling CSV payload...");
      const header = "TIMESTAMP,TEAM_ID,PACKET_COUNT,ALTITUDE_M,PRESSURE_PA,TEMPERATURE_C,DESCENT_RATE_MS,VOLTAGE_V,LATITUDE,LONGITUDE,ROLL,PITCH,YAW,ERROR_CODE\n";
      
      const csvRows = savedPackets.map(p => {
        return [
          p.timestamp,
          p.teamId,
          p.packetCount,
          p.altitude,
          p.pressure,
          p.temperature,
          p.descentRate,
          p.voltage,
          p.latitude,
          p.longitude,
          p.roll,
          p.pitch,
          p.yaw,
          p.errorCode
        ].join(',');
      }).join('\n');

      const blob = new Blob([header + csvRows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      
      const fileTimestamp = new Date().toISOString().replace(/[:T]/g, '-').substring(0, 19);
      link.setAttribute("href", url);
      link.setAttribute("download", `CanSat_GCS_Log_${fileTimestamp}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      logMessage("SUCCESS", `Successfully exported ${savedPackets.length} telemetry packets.`);
    } catch (e: any) {
      logMessage("ERROR", `CSV export failure: ${e.message}`);
    }
  };

  const resetTelemetryPackets = () => {
    if (confirm("Confirm Command: Erase local ground control telemetry log and reset visualizers?")) {
      setPackets([]);
      allParsedPacketsRef.current = [];
      setLastPacket(null);
      setCorruptedPacketsCount(0);
      setSimTime(0);
      logMessage("WARNING", "Telemetry data buffer and error states cleared.");
      
      // Clear charts dataset values
      Object.keys(chartsRef.current).forEach(key => {
        const chart = chartsRef.current[key];
        if (chart) {
          chart.data.datasets[0].data = Array(50).fill(null);
          chart.data.labels = Array(50).fill('');
          chart.update();
        }
      });
    }
  };

  // Graph Image Capture Export
  const exportChartSnapshot = () => {
    try {
      logMessage("INFO", "Preparing analytical graph snapshots...");
      // Export altitude chart canvas as image
      const canvas = canvasRefs.altitude.current;
      if (!canvas) throw new Error("Altitude canvas ref is missing");
      const url = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = `CanSat_Altitude_Chart_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      logMessage("SUCCESS", "Graph snapshot PNG downloaded successfully.");
    } catch (e: any) {
      logMessage("ERROR", `Failed to export chart snapshot: ${e.message}`);
    }
  };

  // 11. Command Transmission Controllers
  const sendMissionCommand = (cmdName: string) => {
    const timestamp = new Date().toISOString().substring(11, 19);
    setCommandStatus(`CMD SENT: ${cmdName}`);
    logMessage("COMMAND", `TRANSMITTED: ${cmdName}`);

    // If active serial port exists, send command bytes
    if (serialPortRef.current && serialPortRef.current.writable) {
      try {
        const encoder = new TextEncoder();
        const writer = serialPortRef.current.writable.getWriter();
        writer.write(encoder.encode(`${cmdName}\n`));
        writer.releaseLock();
        logMessage("SUCCESS", `Command payload '${cmdName}' delivered successfully via serial`);
      } catch (e: any) {
        logMessage("ERROR", `Web Serial transmit error: ${e.message}`);
      }
    }
  };

  const handleSeparationConfirm = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSeparationConfirmVal(val);
    if (val === 100) {
      sendMissionCommand(`CMD,${teamId},SEPARATION,ACTIVATE`);
      setSeparationConfirmVal(0); // Reset after trigger
    }
  };

  const syncPcTime = () => {
    const pcTimeStr = new Date().toISOString().substring(11, 19);
    sendMissionCommand(`CMD,${teamId},SYNC_TIME,${pcTimeStr}`);
    logMessage("SUCCESS", `Time synchronized with Ground Control Station clock: ${pcTimeStr}`);
  };

  // Decode the 4-digit binary code system for explicit error textual responses
  const getErrorCodeInterpretation = (code: string) => {
    if (!code || code.length < 4) return [];
    
    const decodings = [];
    const bit1 = code[0];
    const bit2 = code[1];
    const bit3 = code[2];
    const bit4 = code[3];

    if (bit1 === '1') {
      decodings.push({ text: "DESCENT RATE FAULT: Velocity out of safe 8-10 m/s range", status: 'fault' });
    } else {
      decodings.push({ text: "Descent rate is within safe 8-10 m/s range", status: 'ok' });
    }

    if (bit2 === '1') {
      decodings.push({ text: "GPS FAULT: Spacecraft coordinates signal lost (NaN / Zero)", status: 'fault' });
    } else {
      decodings.push({ text: "GPS tracking signal locked successfully", status: 'ok' });
    }

    if (bit3 === '1') {
      decodings.push({ text: "SEPARATION FAULT: Payload mechanical release failed", status: 'fault' });
    } else {
      decodings.push({ text: "Payload mechanical release successful", status: 'ok' });
    }

    if (bit4 === '1') {
      decodings.push({ text: "EMERGENCY: Parachute deployment systems activated!", status: 'fault' });
    } else {
      decodings.push({ text: "Emergency parachute system inactive", status: 'ok' });
    }

    return decodings;
  };

  const activeErrorInterps = lastPacket ? getErrorCodeInterpretation(lastPacket.errorCode) : [
    { text: "Waiting for telemetry lock...", status: 'ok' },
    { text: "GPS link standby", status: 'ok' },
    { text: "Payload status normal", status: 'ok' },
    { text: "Parachute release loop armed", status: 'ok' },
  ];

  return (
    <div className="gcs-dashboard" id="gcs-root">
      
      {/* 1. Header Control Bar */}
      <header className="gcs-header" id="gcs-header-panel">
        <div className="gcs-brand">
          <div className="gcs-logo-mark">✈</div>
          <div className="gcs-title-block">
            <h1>CANSAT MISSION ground control software</h1>
            <p>OPERATOR WORKSTATION | SECURE LINK VERIFIED</p>
          </div>
        </div>

        {/* Live system state clocks */}
        <div className="gcs-header-stats">
          <div className="gcs-stat-item">
            <span className="gcs-stat-val" style={{ color: 'var(--color-yellow)' }}>{utcTime}</span>
            <span>SYSTEM UTC CLOCK</span>
          </div>
          <div className="gcs-stat-item">
            <span className="gcs-stat-val">{teamId}</span>
            <span>MISSION ID</span>
          </div>
          <div className="gcs-stat-item">
            <span className="gcs-stat-val" style={{ color: lastPacket ? 'var(--color-green)' : 'var(--color-red)' }}>
              {lastPacket ? "TELEMETRY LOCK" : "LINK STANDBY"}
            </span>
            <span>RECEIVER STATE</span>
          </div>
        </div>

        {/* Global Action Controls */}
        <div className="gcs-controls-row">
          <input 
            type="text" 
            className="gcs-select" 
            style={{ fontFamily: 'var(--font-mono)', width: '130px', borderStyle: 'dashed' }}
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="Change TEAM_ID"
            title="Configure expected spacecraft identity prefix"
          />

          {!serialConnected ? (
            <button className="gcs-btn gcs-btn-primary" onClick={connectWebSerial} id="btn-connect-serial">
              <Radio className="w-4 h-4" /> CONNECT SERIAL
            </button>
          ) : (
            <button className="gcs-btn gcs-btn-danger" onClick={disconnectWebSerial} id="btn-disconnect-serial">
              <Wifi className="w-4 h-4 text-red-500" /> DISCONNECT PORT
            </button>
          )}

          <button 
            className={`gcs-btn ${simulationActive ? 'gcs-btn-active' : ''}`}
            onClick={() => setSimulationActive(!simulationActive)}
            id="btn-toggle-sim"
          >
            <Activity className="w-4 h-4" /> SIMULATOR MODE: {simulationActive ? 'ON' : 'OFF'}
          </button>

          <button className="gcs-btn" onClick={exportTelemetryCSV} id="btn-export-csv">
            <Download className="w-4 h-4 text-cyan-400" /> EXPORT CSV LOG
          </button>

          <button className="gcs-btn" onClick={exportChartSnapshot} id="btn-export-chart">
            <TrendingDown className="w-4 h-4 text-yellow-400" /> SNAPSHOT GRAPH
          </button>

          <button className="gcs-btn" onClick={resetTelemetryPackets} id="btn-reset-data" style={{ borderColor: 'rgba(255,51,102,0.3)' }}>
            <RotateCcw className="w-4 h-4 text-red-400" /> RESET TELEMETRY
          </button>
        </div>
      </header>

      {/* 2. Main Workstation Grid */}
      <main className="gcs-grid" id="gcs-dashboard-grid">
        
        {/* ================= LEFT COLUMN: TELEMETRY & MISSON CONTROLS ================= */}
        <div className="gcs-col">
          
          {/* Telemetry Display (Separated into Container and Payload) */}
          <section className="gcs-panel" id="telemetry-display-panel" style={{ flex: '0 0 auto' }}>
            <div className="gcs-panel-header">
              <h2><Cpu className="w-4 h-4 text-cyan-400" /> SPACE VEHICLE TELEMETRY</h2>
              <span className="font-mono text-xs text-cyan-400">
                Pkt Count: {lastPacket?.packetCount ?? 0}
              </span>
            </div>
            
            <div className="gcs-panel-body" style={{ gap: '14px' }}>
              
              {/* SECTION A: CONTAINER TELEMETRY */}
              <div>
                <h3 className="telemetry-section-title">CONTAINER CHASSIS (MAIN)</h3>
                <div className="telemetry-grid">
                  
                  <div className="telemetry-card active-cyan">
                    <span className="telemetry-label">Altitude</span>
                    <span className="telemetry-value">
                      {lastPacket?.altitude != null ? lastPacket.altitude.toFixed(1) : "0.0"}
                      <span className="telemetry-unit">m</span>
                    </span>
                  </div>

                  <div className="telemetry-card active-cyan">
                    <span className="telemetry-label">Pressure</span>
                    <span className="telemetry-value">
                      {lastPacket?.pressure != null ? Math.round(lastPacket.pressure) : "101325"}
                      <span className="telemetry-unit">Pa</span>
                    </span>
                  </div>

                  <div className="telemetry-card active-cyan">
                    <span className="telemetry-label">Atmosphere Temp</span>
                    <span className="telemetry-value">
                      {lastPacket?.temperature != null ? lastPacket.temperature.toFixed(1) : "24.5"}
                      <span className="telemetry-unit">°C</span>
                    </span>
                  </div>

                  <div className="telemetry-card active-cyan">
                    <span className="telemetry-label">Battery Voltage</span>
                    <span className="telemetry-value" style={{ color: (lastPacket?.voltage ?? 4.2) < 3.4 ? 'var(--color-red)' : 'var(--color-green)' }}>
                      {lastPacket?.voltage != null ? lastPacket.voltage.toFixed(3) : "4.200"}
                      <span className="telemetry-unit">V</span>
                    </span>
                  </div>

                </div>
              </div>

              {/* SECTION B: PAYLOAD TELEMETRY */}
              <div>
                <h3 className="telemetry-section-title">PAYLOAD & RECOVERY SENSORS</h3>
                <div className="telemetry-grid">

                  <div className="telemetry-card active-purple">
                    <span className="telemetry-label">Descent Velocity</span>
                    <span className="telemetry-value" style={{ color: lastPacket?.errorCode[0] === '1' ? 'var(--color-red)' : 'var(--color-green)' }}>
                      {lastPacket?.descentRate != null ? lastPacket.descentRate.toFixed(2) : "0.00"}
                      <span className="telemetry-unit">m/s</span>
                    </span>
                  </div>

                  <div className="telemetry-card active-purple">
                    <span className="telemetry-label">Roll Attitude</span>
                    <span className="telemetry-value">
                      {lastPacket?.roll != null ? lastPacket.roll.toFixed(1) : "0.0"}
                      <span className="telemetry-unit">°</span>
                    </span>
                  </div>

                  <div className="telemetry-card active-purple">
                    <span className="telemetry-label">Pitch Attitude</span>
                    <span className="telemetry-value">
                      {lastPacket?.pitch != null ? lastPacket.pitch.toFixed(1) : "0.0"}
                      <span className="telemetry-unit">°</span>
                    </span>
                  </div>

                  <div className="telemetry-card active-purple">
                    <span className="telemetry-label">Yaw Heading</span>
                    <span className="telemetry-value">
                      {lastPacket?.yaw != null ? lastPacket.yaw.toFixed(1) : "0.0"}
                      <span className="telemetry-unit">°</span>
                    </span>
                  </div>

                </div>
              </div>

            </div>
          </section>

          {/* Mission Control Commands & Execute Console */}
          <section className="gcs-panel" id="mission-commands-panel" style={{ flex: '1 1 auto' }}>
            <div className="gcs-panel-header">
              <h2><Battery className="w-4 h-4 text-purple-400" /> MISSION ACTUATOR CONTROLS</h2>
              <span className="font-mono text-xs text-purple-400" style={{ fontWeight: 600 }}>{commandStatus}</span>
            </div>
            
            <div className="gcs-panel-body">
              <div className="mission-control-buttons">
                <button 
                  className="gcs-btn gcs-btn-danger" 
                  onClick={() => sendMissionCommand(`CMD,${teamId},PARACHUTE,DEPLOY`)}
                  title="Deploy emergency recovery parachute system"
                >
                  <AlertTriangle className="w-4 h-4" /> ARM PARACHUTE
                </button>
                <button 
                  className="gcs-btn" 
                  onClick={() => sendMissionCommand(`CMD,${teamId},BUZZER,TOGGLE`)}
                  style={{ borderColor: 'var(--color-purple)' }}
                  title="Force redundant onboard audio beacon buzzer activation"
                >
                  <Compass className="w-4 h-4" /> AUX BEACON ACTIVATE
                </button>
              </div>

              {/* Confirm Slider for Separation command */}
              <div className="confirmation-slider-container">
                <div className="confirm-label">SLIDE TO EXECUTE PAYLOAD SEPARATION</div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={separationConfirmVal} 
                  onChange={handleSeparationConfirm}
                  className="confirm-range"
                  title="Verification slide to prevent accidental satellite release"
                />
                <div className="font-mono text-xs text-yellow-500 font-bold">{separationConfirmVal}%</div>
              </div>

              {/* Redundant Activations Row */}
              <div className="gcs-controls-row" style={{ marginTop: '4px' }}>
                <button className="gcs-btn" onClick={syncPcTime} style={{ flex: 1, fontSize: '11px' }}>
                  <Clock className="w-3.5 h-3.5 text-cyan-400" /> SYNC SPACECRAFT RTC
                </button>
                <button 
                  className="gcs-btn" 
                  onClick={() => sendMissionCommand(`CMD,${teamId},AUX_BATTERY,ENGAGE`)}
                  style={{ flex: 1, fontSize: '11px', borderColor: 'rgba(255,204,0,0.3)' }}
                >
                  <Cpu className="w-3.5 h-3.5 text-yellow-400" /> REDUNDANT BATT RELAY
                </button>
              </div>

              {/* Terminal Logs Console */}
              <div className="terminal-container">
                <div className="terminal-title">
                  <span>GROUND OPERATOR TELEMETRY CONSOLE</span>
                  <span>LINES: {logs.length}</span>
                </div>
                <div className="terminal-body" id="console-output">
                  {logs.length === 0 ? (
                    <div className="text-gray-600 text-xs italic">System idle. Establish serial port or trigger Flight Simulator...</div>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className="terminal-row">
                        <span className="terminal-time">{log.timestamp}</span>
                        <span className={`terminal-msg ${
                          log.type === 'COMMAND' ? 'command' : 
                          log.type === 'ERROR' ? 'error' : 
                          log.type === 'SUCCESS' ? 'success' : ''
                        }`}>
                          [{log.type}] {log.message}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={consoleEndRef} />
                </div>
              </div>

            </div>
          </section>

        </div>

        {/* ================= CENTER COLUMN: MAP, 3D & GRAPHS ================= */}
        <div className="gcs-col" style={{ gridColumn: '2' }}>
          
          {/* Map and 3D Visualizer Split */}
          <div className="gcs-center-grid">
            
            {/* Tracking Map Panel */}
            <section className="gcs-panel" id="map-tracking-panel">
              <div className="gcs-panel-header">
                <h2><MapPin className="w-4 h-4 text-cyan-400" /> FLIGHT GPS TRAJECTORY</h2>
                <span className="font-mono text-xs text-cyan-400">
                  {lastPacket ? `${lastPacket.latitude.toFixed(5)}, ${lastPacket.longitude.toFixed(5)}` : "STANDBY"}
                </span>
              </div>
              <div className="gcs-panel-body" style={{ padding: '0' }}>
                <div className="map-container" id="map-canvas"></div>
              </div>
            </section>

            {/* 3D Orientation Gyro Panel */}
            <section className="gcs-panel" id="threejs-gyro-panel">
              <div className="gcs-panel-header">
                <h2><Compass className="w-4 h-4 text-purple-400" /> 3D GYRO HORIZON VISUALIZER</h2>
                <span className="font-mono text-xs text-purple-400">
                  {lastPacket ? `R:${lastPacket.roll}° P:${lastPacket.pitch}° Y:${lastPacket.yaw}°` : "CALIBRATED"}
                </span>
              </div>
              <div className="gcs-panel-body" style={{ padding: '0', position: 'relative' }}>
                <div className="canvas-3d-wrapper" id="canvas-3d"></div>
                
                {/* Embedded Artificial Horizon Overlay */}
                <div className="horizon-hud">
                  <div>ROLL: {lastPacket?.roll != null ? lastPacket.roll.toFixed(1) : "0.0"}°</div>
                  <div>PITCH: {lastPacket?.pitch != null ? lastPacket.pitch.toFixed(1) : "0.0"}°</div>
                </div>
              </div>
            </section>

          </div>

          {/* Charts Grid Panel */}
          <section className="gcs-panel" id="real-time-charts-panel">
            <div className="gcs-panel-header">
              <h2><Activity className="w-4 h-4 text-green-400" /> SMOOTH GROUND INSTRUMENTATION GRAPHS (LAST 50 PACKETS)</h2>
              <span className="font-mono text-xs text-green-400">SAMPLING: 1.0Hz</span>
            </div>
            <div className="gcs-panel-body">
              <div className="charts-grid">
                
                <div className="chart-wrapper">
                  <div className="font-mono text-[10px] text-cyan-400 absolute top-1 left-2 z-10 font-bold uppercase tracking-wide">ALTITUDE CHASSIS PROFILE (m)</div>
                  <canvas ref={canvasRefs.altitude} id="chart-altitude"></canvas>
                </div>

                <div className="chart-wrapper">
                  <div className="font-mono text-[10px] text-green-400 absolute top-1 left-2 z-10 font-bold uppercase tracking-wide">BAROMETRIC ATMOSPHERE PRESSURE (Pa)</div>
                  <canvas ref={canvasRefs.pressure} id="chart-pressure"></canvas>
                </div>

                <div className="chart-wrapper">
                  <div className="font-mono text-[10px] text-yellow-400 absolute top-1 left-2 z-10 font-bold uppercase tracking-wide">ATMOSPHERE TEMPERATURE (°C)</div>
                  <canvas ref={canvasRefs.temperature} id="chart-temperature"></canvas>
                </div>

                <div className="chart-wrapper">
                  <div className="font-mono text-[10px] text-rose-400 absolute top-1 left-2 z-10 font-bold uppercase tracking-wide">DESCENT VELOCITY VECTOR (m/s)</div>
                  <canvas ref={canvasRefs.descentRate} id="chart-descentRate"></canvas>
                </div>

              </div>

              {/* Secondary Voltage bar */}
              <div style={{ marginTop: '4px' }}>
                <div className="chart-wrapper" style={{ height: '90px' }}>
                  <div className="font-mono text-[10px] text-fuchsia-400 absolute top-1 left-2 z-10 font-bold uppercase tracking-wide">BATTERY BUS CELL POTENTIAL (V)</div>
                  <canvas ref={canvasRefs.voltage} id="chart-voltage"></canvas>
                </div>
              </div>
            </div>
          </section>

        </div>

        {/* ================= RIGHT COLUMN: VIDEO FEED & ERROR SYSTEMS ================= */}
        <div className="gcs-col" style={{ gridColumn: '3' }}>
          
          {/* Live Camera Stream and HUD overlay */}
          <section className="gcs-panel" id="camera-hud-panel">
            <div className="gcs-panel-header">
              <h2><Video className="w-4 h-4 text-cyan-400" /> GROUND TELEMETRY CAMERA FEED</h2>
              <span className={`font-mono text-xs ${cameraStreamActive ? 'text-green-400' : 'text-gray-400'}`}>
                {cameraStreamActive ? "STREAM LIVE" : "STANDBY"}
              </span>
            </div>
            
            <div className="gcs-panel-body">
              
              {/* Device Selector */}
              <div className="gcs-controls-row" style={{ justifyContent: 'space-between' }}>
                <select 
                  className="gcs-select" 
                  value={selectedCameraId} 
                  onChange={(e) => setSelectedCameraId(e.target.value)}
                  style={{ flex: 1 }}
                  title="Configure ground receive camera antenna hardware source"
                >
                  {cameraDevices.length === 0 ? (
                    <option value="">No Camera Devices Discovered</option>
                  ) : (
                    cameraDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Receive Camera Antenna ${d.deviceId.substring(0, 5)}`}
                      </option>
                    ))
                  )}
                </select>

                <button 
                  className={`gcs-btn ${cameraStreamActive ? 'gcs-btn-danger' : 'gcs-btn-primary'}`} 
                  onClick={toggleCameraStream}
                >
                  {cameraStreamActive ? "SHUTDOWN" : "BOOT STREAM"}
                </button>
              </div>

              {/* Viewport Frame with HUD overlay */}
              <div className="camera-wrapper">
                <video ref={videoRef} playsInline muted style={{ display: cameraStreamActive ? 'block' : 'none' }} />
                
                {/* HUD Overlay graphics */}
                <div className="camera-hud-overlay">
                  <div className="camera-hud-top">
                    <div>ALT: {lastPacket?.altitude != null ? `${lastPacket.altitude.toFixed(1)}m` : "0.0m"}</div>
                    <div>CAM HARDWARE LOCKED [FPS: 30]</div>
                  </div>

                  <div className="camera-hud-crosshair"></div>

                  <div className="camera-hud-bottom">
                    <div>GPS: {lastPacket ? `${lastPacket.latitude.toFixed(4)}, ${lastPacket.longitude.toFixed(4)}` : "NO LOCK"}</div>
                    <div>ROLL: {lastPacket?.roll != null ? `${lastPacket.roll.toFixed(1)}°` : "0.0°"}</div>
                  </div>
                </div>

                {!cameraStreamActive && (
                  <div className="camera-placeholder">
                    <Video className="w-10 h-10 text-gray-700" />
                    <span className="text-xs">
                      {cameraError ? cameraError : "Ground Camera Receive standby. Click Boot Stream to connect."}
                    </span>
                  </div>
                )}
              </div>

            </div>
          </section>

          {/* Fault injection simulator cockpit */}
          {simulationActive && (
            <section className="gcs-panel" style={{ borderColor: 'var(--color-yellow)' }}>
              <div className="gcs-panel-header" style={{ backgroundColor: 'rgba(255,204,0,0.1)', borderBottomColor: 'var(--color-yellow)' }}>
                <h2 style={{ color: 'var(--color-yellow)' }}><Cpu className="w-4 h-4" /> FLIGHT INJECT FAULTS (TEST COCKPIT)</h2>
                <span className="font-mono text-xs text-yellow-500 font-bold">STATE: {simPhase}</span>
              </div>
              <div className="gcs-panel-body" style={{ gap: '8px' }}>
                <label className="flex items-center gap-2 cursor-pointer font-mono text-xs text-gray-300">
                  <input 
                    type="checkbox" 
                    checked={faultDescentRate} 
                    onChange={(e) => {
                      setFaultDescentRate(e.target.checked);
                      logMessage("WARNING", `Fault Injection: Descent Rate bounds altered to ${e.target.checked ? 'UNSAFE' : 'SAFE'}`);
                    }}
                    className="accent-yellow-500"
                  />
                  Inject Descent Rate Fault (forces descent &gt; 10m/s)
                </label>

                <label className="flex items-center gap-2 cursor-pointer font-mono text-xs text-gray-300">
                  <input 
                    type="checkbox" 
                    checked={faultGPSLoss} 
                    onChange={(e) => {
                      setFaultGPSLoss(e.target.checked);
                      logMessage("WARNING", `Fault Injection: Spacecraft GPS Signal link ${e.target.checked ? 'LOST' : 'LOCK'}`);
                    }}
                    className="accent-yellow-500"
                  />
                  Inject GPS Link Outage (forces Lat/Lon to NaN)
                </label>

                <label className="flex items-center gap-2 cursor-pointer font-mono text-xs text-gray-300">
                  <input 
                    type="checkbox" 
                    checked={faultSepFailure} 
                    onChange={(e) => {
                      setFaultSepFailure(e.target.checked);
                      logMessage("WARNING", `Fault Injection: Separation Mechanism ${e.target.checked ? 'FAULTY' : 'NORMAL'}`);
                    }}
                    className="accent-yellow-500"
                  />
                  Inject Payload Separation Failure (Bit 3 High)
                </label>

                <label className="flex items-center gap-2 cursor-pointer font-mono text-xs text-gray-300">
                  <input 
                    type="checkbox" 
                    checked={faultChuteFailure} 
                    onChange={(e) => {
                      setFaultChuteFailure(e.target.checked);
                      logMessage("WARNING", `Fault Injection: Emergency Parachute System ${e.target.checked ? 'DEPLOYED' : 'ARMED'}`);
                    }}
                    className="accent-yellow-500"
                  />
                  Inject Emergency Parachute Activation (Bit 4 High)
                </label>
              </div>
            </section>
          )}

          {/* Emergency Status & 4-Digit Binary Error Code Monitoring Panel */}
          <section className="gcs-panel" id="emergency-error-panel" style={{ flex: '1' }}>
            <div className="gcs-panel-header" style={{ borderColor: lastPacket?.errorCode !== "0000" && lastPacket ? 'var(--color-red)' : '' }}>
              <h2 style={{ color: lastPacket?.errorCode !== "0000" && lastPacket ? 'var(--color-red)' : '' }}>
                <ShieldAlert className="w-4 h-4" /> EMERGENCY FAULT TELEMETRY SYSTEM
              </h2>
              <span className={`font-mono text-xs font-bold ${lastPacket?.errorCode !== "0000" && lastPacket ? 'text-red-500' : 'text-green-500'}`}>
                {lastPacket?.errorCode !== "0000" && lastPacket ? "WARNINGS ACTIVE" : "VEHICLE SAFE"}
              </span>
            </div>
            
            <div className="gcs-panel-body error-status-panel">
              
              {/* 4-Digit Binary Display Box */}
              <div className="binary-code-display">
                
                {/* DIGIT 1: Descent Rate */}
                <div className={`binary-digit-box ${lastPacket?.errorCode[0] === '1' ? 'fault' : 'ok'}`}>
                  <span className={`digit-value ${lastPacket?.errorCode[0] === '1' ? 'fault' : 'ok'}`}>
                    {lastPacket ? lastPacket.errorCode[0] : "0"}
                  </span>
                  <span className="digit-label">DESCENT</span>
                </div>

                {/* DIGIT 2: GPS Status */}
                <div className={`binary-digit-box ${lastPacket?.errorCode[1] === '1' ? 'fault' : 'ok'}`}>
                  <span className={`digit-value ${lastPacket?.errorCode[1] === '1' ? 'fault' : 'ok'}`}>
                    {lastPacket ? lastPacket.errorCode[1] : "0"}
                  </span>
                  <span className="digit-label">GPS SYNC</span>
                </div>

                {/* DIGIT 3: Payload Separation */}
                <div className={`binary-digit-box ${lastPacket?.errorCode[2] === '1' ? 'fault' : 'ok'}`}>
                  <span className={`digit-value ${lastPacket?.errorCode[2] === '1' ? 'fault' : 'ok'}`}>
                    {lastPacket ? lastPacket.errorCode[2] : "0"}
                  </span>
                  <span className="digit-label">SEP STATE</span>
                </div>

                {/* DIGIT 4: Emergency Parachute */}
                <div className={`binary-digit-box ${lastPacket?.errorCode[3] === '1' ? 'fault' : 'ok'}`}>
                  <span className={`digit-value ${lastPacket?.errorCode[3] === '1' ? 'fault' : 'ok'}`}>
                    {lastPacket ? lastPacket.errorCode[3] : "0"}
                  </span>
                  <span className="digit-label">PARACHUTE</span>
                </div>

              </div>

              {/* Color-coded textual feedback */}
              <div className="error-feedback-list">
                {activeErrorInterps.map((interp, index) => (
                  <div key={index} className="feedback-item">
                    <span className={`feedback-status-dot ${interp.status}`} />
                    <span className={`feedback-text ${interp.status === 'fault' ? 'fault' : 'text-gray-400'}`}>
                      {interp.text}
                    </span>
                  </div>
                ))}
              </div>

              {/* Data Loss Jitter Statistics */}
              <div className="gcs-controls-row" style={{ justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                <span>CORRUPTED DATA PACKETS: {corruptedPacketsCount}</span>
                <span>PACKETS IN BUFFER: {allParsedPacketsRef.current.length}</span>
              </div>

            </div>
          </section>

        </div>

      </main>

      {/* 3. Global Footer status metadata */}
      <footer className="gcs-footer" id="gcs-footer-element">
        <div>INDIA SPACE LAB | CANSAT & CUBESAT SATELITE EDUCATION PROGRAM WORKSTATION</div>
        <div className="gcs-footer-links">
          <span>PORT BAUD: 9600</span>
          <span>● WEB SERIAL INTERFACE STANDBY</span>
        </div>
      </footer>

    </div>
  );
}
