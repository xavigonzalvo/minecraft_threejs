import * as THREE from 'three';

export class PlayerArm {
  constructor(camera) {
    this.group = new THREE.Group();

    const skinMat = new THREE.MeshLambertMaterial({ color: 0xc49a6c });

    // Forearm
    const armGeo = new THREE.BoxGeometry(0.1, 0.35, 0.1);
    this.arm = new THREE.Mesh(armGeo, skinMat);

    // Hand — sits at bottom of arm
    const handGeo = new THREE.BoxGeometry(0.1, 0.08, 0.12);
    this.hand = new THREE.Mesh(handGeo, skinMat);
    this.hand.position.set(0, -0.215, 0.01);

    this.group.add(this.arm);
    this.group.add(this.hand);

    // Position in lower-right of view, beyond near plane
    this.group.position.set(0.32, -0.38, -0.45);
    // Natural angle
    this.group.rotation.set(-0.15, -0.1, 0.05);

    camera.add(this.group);

    this._bobTime = 0;
    this._swingTime = 0;  // 0 = idle, >0 = swinging
    this._swingDuration = 0.25;
    this._baseRotX = -0.15;
    this._baseRotY = -0.1;
    this._baseRotZ = 0.05;

    document.addEventListener('block-break', () => this.swing());
  }

  swing() {
    this._swingTime = this._swingDuration;
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  update(dt, player) {
    const speed = Math.sqrt(
      player.velocity.x * player.velocity.x +
      player.velocity.z * player.velocity.z
    );
    const isWalking = speed > 0.5;

    const bobSpeed = isWalking ? 8 : 1.5;
    const bobAmount = isWalking ? 0.015 : 0.005;

    this._bobTime += dt * bobSpeed;

    this.group.position.y = -0.38 + Math.sin(this._bobTime) * bobAmount;
    this.group.position.x = 0.32 + Math.cos(this._bobTime * 0.5) * bobAmount * 0.5;

    // Swing animation
    if (this._swingTime > 0) {
      this._swingTime = Math.max(0, this._swingTime - dt);
      // t goes 1→0 over the swing duration
      const t = this._swingTime / this._swingDuration;
      // Quick arc: peaks at t=0.5, returns to rest at t=0
      const swing = Math.sin(t * Math.PI);
      this.group.rotation.x = this._baseRotX - swing * 0.8;
      this.group.rotation.z = this._baseRotZ + swing * 0.3;
      this.group.position.z = -0.45 + swing * 0.08;
    } else {
      this.group.rotation.set(this._baseRotX, this._baseRotY, this._baseRotZ);
      this.group.position.z = -0.45;
    }
  }

  dispose() {
    this.arm.geometry.dispose();
    this.hand.geometry.dispose();
    this.arm.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
