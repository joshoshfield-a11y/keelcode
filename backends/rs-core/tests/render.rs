//! GPU-free render-path tests (Wave 2b).
//!
//! These run on a headless box: they exercise the snapshot → instance →
//! camera-matrix path the renderer consumes, proving everything up to the
//! GPU boundary works without a display or adapter.

use glam::DVec3;
use keel_rs::demo::Demo;
use keel_rs::render::{MAX_INSTANCES, build_instances, view_proj_matrix};

#[test]
fn demo_snapshot_feeds_the_renderer() {
    let mut demo = Demo::new(1337);
    demo.bind_phases();
    // run a couple of seconds of the scripted demo
    for _ in 0..120 {
        demo.step();
    }
    let snap = demo.render_snapshot();
    assert!(!snap.items.is_empty(), "snapshot has no items");

    let inst = build_instances(&snap);
    assert_eq!(inst.len(), snap.items.len(), "one instance per item");
    assert!(inst.len() < MAX_INSTANCES, "instance buffer overflow");

    // every instance matrix + color must be finite (a NaN here would
    // silently poison the vertex shader)
    for i in &inst {
        for row in &i.model {
            for v in row {
                assert!(v.is_finite(), "non-finite instance matrix element");
            }
        }
        for c in &i.color {
            assert!(c.is_finite(), "non-finite instance color");
        }
    }

    // the camera matrix maps a point in front of the camera into NDC
    let m = glam::Mat4::from_cols_array_2d(&view_proj_matrix(
        snap.cam_pos,
        snap.cam_forward,
        16.0 / 9.0,
    ));
    let fwd = DVec3::new(snap.cam_forward.x, snap.cam_forward.y, snap.cam_forward.z).normalize();
    let p = snap.cam_pos + fwd * 8.0;
    let clip = m * glam::Vec4::new(p.x as f32, p.y as f32, p.z as f32, 1.0);
    assert!(clip.w > 0.0, "forward point ended up behind the camera");
    let ndc = clip / clip.w;
    assert!(
        ndc.x.abs() <= 1.0 && ndc.y.abs() <= 1.0,
        "off-screen: {ndc}"
    );
    assert!(
        (0.0..=1.0).contains(&ndc.z),
        "depth outside [0,1]: {}",
        ndc.z
    );
}

#[test]
fn empty_scene_still_builds() {
    // degenerate snapshot: renderer must not divide by zero or panic
    let snap = keel_rs::demo::RenderSnapshot {
        cam_pos: DVec3::new(0.0, 6.0, 12.0),
        cam_forward: DVec3::new(0.0, -0.4, -1.0),
        items: Vec::new(),
    };
    assert!(build_instances(&snap).is_empty());
    let m = view_proj_matrix(snap.cam_pos, snap.cam_forward, 16.0 / 9.0);
    for row in m {
        for v in row {
            assert!(v.is_finite());
        }
    }
}
