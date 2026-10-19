//! Minimal wgpu forward renderer for the arena demo (Wave 2b).
//!
//! The GPU-free half lives here: [`build_instances`] maps a
//! [`RenderSnapshot`](crate::demo::RenderSnapshot) to one instanced box per
//! item, and [`view_proj_matrix`] builds the camera matrix. `renderer.rs`
//! holds the wgpu half; `window.rs` the winit glue. Everything in this
//! module is unit-testable without a GPU.
//!
//! Visuals are neutral placeholders (ADR-0001: no voxel art direction on
//! the KeelCode demo). Sizes below are renderer-local stand-ins, not sim
//! state — behavioral parity lives in the sim, not in these numbers.

pub mod renderer;
pub mod window;

use glam::{DVec3, Mat4, Vec3};

use crate::demo::{RenderKind, RenderSnapshot};

/// Hard cap on instances per frame. The demo scene issues ~20; this leaves
/// headroom for wave-3 scenes without reallocating the instance buffer.
pub const MAX_INSTANCES: usize = 2048;

/// One instanced box: a rigid transform plus an opaque RGBA color.
/// `#[repr(C)]` + Pod so it can be `cast_slice`d into the vertex buffer.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuInstance {
    pub model: [[f32; 4]; 4], // column-major mat4
    pub color: [f32; 4],
}

fn instance(pos: DVec3, ry: f64, sx: f64, sy: f64, sz: f64, color: [f32; 3]) -> GpuInstance {
    let m = Mat4::from_translation(Vec3::new(pos.x as f32, pos.y as f32, pos.z as f32))
        * Mat4::from_rotation_y(ry as f32)
        * Mat4::from_scale(Vec3::new(sx as f32, sy as f32, sz as f32));
    GpuInstance {
        model: m.to_cols_array_2d(),
        color: [color[0], color[1], color[2], 1.0],
    }
}

/// Map a render snapshot to one instanced box per item.
///
/// Placeholder sizes (renderer-local, not sim state):
/// - Floor: 40×1×40 slab at y∈[−1,0] (the ground static is ±20, top at 0).
/// - Wall: the snapshot carries only center + `scale: 1`; walls at
///   |z|≈20.5 run along x (40×3×1), walls at |x|≈20.5 run along z (1×3×40).
/// - Pillar: 1.6×6×1.6 (the static is ±0.8, 0..6).
/// - Player/Enemy: standing boxes with the item's yaw; Projectile: small
///   cube from the item's scale; Pickup: 0.5³ cube at the item's position.
pub fn build_instances(snap: &RenderSnapshot) -> Vec<GpuInstance> {
    snap.items
        .iter()
        .map(|it| match it.kind {
            RenderKind::Floor => {
                instance(DVec3::new(0.0, -0.5, 0.0), 0.0, 40.0, 1.0, 40.0, it.color)
            }
            RenderKind::Wall => {
                if it.pos.z.abs() > 19.0 {
                    // runs along x
                    instance(
                        DVec3::new(0.0, 1.5, it.pos.z),
                        0.0,
                        40.0,
                        3.0,
                        1.0,
                        it.color,
                    )
                } else {
                    // runs along z
                    instance(
                        DVec3::new(it.pos.x, 1.5, 0.0),
                        0.0,
                        1.0,
                        3.0,
                        40.0,
                        it.color,
                    )
                }
            }
            RenderKind::Pillar => instance(
                DVec3::new(it.pos.x, 3.0, it.pos.z),
                0.0,
                1.6,
                6.0,
                1.6,
                it.color,
            ),
            RenderKind::Player => instance(it.pos, it.ry, 0.7, 1.7, 0.7, it.color),
            RenderKind::Enemy => instance(it.pos, it.ry, 0.8, 1.4, 0.8, it.color),
            RenderKind::Projectile => {
                let s = it.scale as f64;
                instance(it.pos, 0.0, s, s, s, it.color)
            }
            RenderKind::Pickup => instance(it.pos, 0.0, 0.5, 0.5, 0.5, it.color),
        })
        .collect()
}

/// Right-handed look-at × perspective, corrected to wgpu's [0,1] depth.
/// `cam_forward` need not be normalized. Falls back to −Z if degenerate.
pub fn view_proj_matrix(cam_pos: DVec3, cam_forward: DVec3, aspect: f32) -> [[f32; 4]; 4] {
    let eye = Vec3::new(cam_pos.x as f32, cam_pos.y as f32, cam_pos.z as f32);
    let fwd = Vec3::new(
        cam_forward.x as f32,
        cam_forward.y as f32,
        cam_forward.z as f32,
    );
    let fwd = if fwd.length_squared() < 1e-12 {
        Vec3::NEG_Z
    } else {
        fwd.normalize()
    };
    let view = Mat4::look_at_rh(eye, eye + fwd, Vec3::Y);
    let proj = Mat4::perspective_rh(60.0f32.to_radians(), aspect, 0.1, 600.0);
    // OpenGL [−1,1] depth → wgpu [0,1] depth.
    const OPENGL_TO_WGPU: Mat4 = Mat4::from_cols_array_2d(&[
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 0.5, 0.0],
        [0.0, 0.0, 0.5, 1.0],
    ]);
    (OPENGL_TO_WGPU * proj * view).to_cols_array_2d()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::{RenderItem, RenderSnapshot};

    fn snapshot(kinds: &[(RenderKind, DVec3)]) -> RenderSnapshot {
        RenderSnapshot {
            cam_pos: DVec3::new(0.0, 6.0, 12.0),
            cam_forward: DVec3::new(0.0, -0.4, -1.0),
            items: kinds
                .iter()
                .map(|(k, p)| RenderItem {
                    kind: *k,
                    pos: *p,
                    ry: 0.0,
                    scale: 1.0,
                    color: [0.5, 0.5, 0.5],
                })
                .collect(),
        }
    }

    #[test]
    fn one_instance_per_item_with_finite_matrices() {
        let snap = snapshot(&[
            (RenderKind::Floor, DVec3::new(0.0, 0.0, 0.0)),
            (RenderKind::Wall, DVec3::new(0.0, 1.5, -20.5)),
            (RenderKind::Wall, DVec3::new(20.5, 1.5, 0.0)),
            (RenderKind::Pillar, DVec3::new(3.0, 3.0, 4.0)),
            (RenderKind::Player, DVec3::new(0.0, 0.85, 8.0)),
            (RenderKind::Enemy, DVec3::new(2.0, 0.7, 2.0)),
            (RenderKind::Projectile, DVec3::new(1.0, 1.0, 1.0)),
            (RenderKind::Pickup, DVec3::new(6.0, 0.75, -4.0)),
        ]);
        let inst = build_instances(&snap);
        assert_eq!(inst.len(), snap.items.len());
        for i in &inst {
            for row in &i.model {
                for v in row {
                    assert!(v.is_finite(), "non-finite matrix element");
                }
            }
            assert_eq!(i.color[3], 1.0);
        }
    }

    #[test]
    fn wall_heuristic_orients_along_the_right_axis() {
        // wall at z≈−20.5 must span x (40 wide, 1 deep) …
        let [w] = build_instances(&snapshot(&[(
            RenderKind::Wall,
            DVec3::new(0.0, 1.5, -20.5),
        )]))
        .try_into()
        .unwrap();
        let m = Mat4::from_cols_array_2d(&w.model);
        let (sx, sy, sz) = (m.x_axis.length(), m.y_axis.length(), m.z_axis.length());
        assert!((sx - 40.0).abs() < 1e-4, "sx={sx}");
        assert!((sy - 3.0).abs() < 1e-4, "sy={sy}");
        assert!((sz - 1.0).abs() < 1e-4, "sz={sz}");
        // … wall at x≈20.5 must span z instead.
        let [w] = build_instances(&snapshot(&[(RenderKind::Wall, DVec3::new(20.5, 1.5, 0.0))]))
            .try_into()
            .unwrap();
        let m = Mat4::from_cols_array_2d(&w.model);
        let (sx, sy, sz) = (m.x_axis.length(), m.y_axis.length(), m.z_axis.length());
        assert!((sx - 1.0).abs() < 1e-4, "sx={sx}");
        assert!((sy - 3.0).abs() < 1e-4, "sy={sy}");
        assert!((sz - 40.0).abs() < 1e-4, "sz={sz}");
    }

    #[test]
    fn floor_slab_covers_the_arena() {
        let [f] = build_instances(&snapshot(&[(RenderKind::Floor, DVec3::ZERO)]))
            .try_into()
            .unwrap();
        let m = Mat4::from_cols_array_2d(&f.model);
        let (sx, sy, sz) = (m.x_axis.length(), m.y_axis.length(), m.z_axis.length());
        assert!((sx - 40.0).abs() < 1e-4 && (sy - 1.0).abs() < 1e-4 && (sz - 40.0).abs() < 1e-4);
        // slab top sits at y=0 (translation −0.5 + half-height 0.5)
        assert!((m.w_axis.y - -0.5).abs() < 1e-4);
    }

    #[test]
    fn view_proj_maps_forward_point_into_ndc() {
        let eye = DVec3::new(0.0, 6.0, 12.0);
        let fwd = DVec3::new(0.0, -0.4, -1.0).normalize();
        let m = Mat4::from_cols_array_2d(&view_proj_matrix(eye, fwd, 16.0 / 9.0));
        // a point 8 m in front of the camera must land inside the NDC box
        let p = eye + fwd * 8.0;
        let clip = m * glam::Vec4::new(p.x as f32, p.y as f32, p.z as f32, 1.0);
        let ndc = clip / clip.w;
        assert!(clip.w > 0.0, "point behind the camera");
        assert!(
            ndc.x.abs() <= 1.0 && ndc.y.abs() <= 1.0,
            "off-screen: {ndc}"
        );
        assert!(
            (0.0..=1.0).contains(&ndc.z),
            "depth out of [0,1]: {}",
            ndc.z
        );
    }

    #[test]
    fn view_proj_degenerate_forward_does_not_panic() {
        let m = view_proj_matrix(DVec3::new(0.0, 6.0, 12.0), DVec3::ZERO, 16.0 / 9.0);
        for row in m {
            for v in row {
                assert!(v.is_finite());
            }
        }
    }
}
