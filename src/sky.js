import * as THREE from 'three';

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.3; // Start at morning (0-1 cycle)
    this.alwaysDay = false;

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(500, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x4488ff) },
        bottomColor: { value: new THREE.Color(0x88bbff) },
        sunPosition: { value: new THREE.Vector3(100, 200, 100) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 sunPosition;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          float t = max(0.0, h);
          vec3 sky = mix(bottomColor, topColor, pow(t, 0.5));

          // Sun glow
          vec3 sunDir = normalize(sunPosition);
          vec3 viewDir = normalize(vWorldPosition);
          float sunDot = max(0.0, dot(viewDir, sunDir));
          vec3 sunColor = vec3(1.0, 0.95, 0.8);
          sky += sunColor * pow(sunDot, 128.0) * 2.0;
          sky += sunColor * pow(sunDot, 16.0) * 0.3;

          // Horizon haze
          float horizon = 1.0 - abs(h);
          sky += vec3(0.8, 0.85, 0.9) * pow(horizon, 8.0) * 0.4;

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(this.skyMesh);

    // Sun
    this.sunLight = new THREE.DirectionalLight(0xfff5e0, 1.5);
    this.sunLight.position.set(100, 200, 100);
    scene.add(this.sunLight);

    // Ambient light
    this.ambientLight = new THREE.AmbientLight(0x6688aa, 0.6);
    scene.add(this.ambientLight);

    // Hemisphere light for better color
    this.hemiLight = new THREE.HemisphereLight(0x88bbff, 0x445522, 0.3);
    scene.add(this.hemiLight);

    // Fog
    scene.fog = new THREE.FogExp2(0x88bbff, 0.005);
  }

  isNight() {
    if (this.alwaysDay) return false;
    const sunAngle = this.time * Math.PI * 2;
    return Math.sin(sunAngle) < 0;
  }

  update(dt, playerPos) {
    if (!this.alwaysDay) {
      this.time += dt * 0.01; // Slow day/night cycle
      if (this.time > 1) this.time -= 1;
    }

    const sunAngle = this.alwaysDay ? Math.PI / 2 : this.time * Math.PI * 2;
    const sunY = Math.sin(sunAngle) * 300;
    const sunX = Math.cos(sunAngle) * 300;

    this.sunLight.position.set(sunX, Math.max(sunY, 10), 100);

    // Adjust colors based on time of day
    const dayFactor = Math.max(0, Math.sin(sunAngle));

    const topDay = new THREE.Color(0x4488ff);
    const topNight = new THREE.Color(0x0a0a2e);
    const bottomDay = new THREE.Color(0x88bbff);
    const bottomNight = new THREE.Color(0x1a1a3e);

    const topColor = topDay.clone().lerp(topNight, 1 - dayFactor);
    const bottomColor = bottomDay.clone().lerp(bottomNight, 1 - dayFactor);

    this.skyMesh.material.uniforms.topColor.value = topColor;
    this.skyMesh.material.uniforms.bottomColor.value = bottomColor;
    this.skyMesh.material.uniforms.sunPosition.value.set(sunX, sunY, 100);

    this.sunLight.intensity = 0.3 + dayFactor * 1.2;
    this.ambientLight.intensity = 0.15 + dayFactor * 0.45;

    const fogDay = new THREE.Color(0x88bbff);
    const fogNight = new THREE.Color(0x0a0a2e);
    this.scene.fog.color = fogDay.clone().lerp(fogNight, 1 - dayFactor);

    this.dayFactor = dayFactor;

    // Keep sky centered on player
    if (playerPos) {
      this.skyMesh.position.set(playerPos.x, playerPos.y, playerPos.z);
    }
  }
}
