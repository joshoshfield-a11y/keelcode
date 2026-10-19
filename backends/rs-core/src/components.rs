//! Canonical components — schema-exact field names.
//!
//! Field names follow `framework/schema/component.schema.json` exactly (the
//! portable surface). `glam` with the `serde` feature serializes `DVec3` as
//! `{"x","y","z"}` and `DQuat` as `{"x","y","z","w"}`, matching the schema.
//! Sim math is `f64` everywhere.

use glam::{DQuat, DVec3};
use serde::{Deserialize, Serialize};

/// Schema-exact `{"x","y","z"}` / `{"x","y","z","w"}` maps for glam types.
///
/// NOTE: INTERFACE.md claims glam's `serde` feature emits these maps, but
/// glam 0.30 actually serializes vectors/quats as tuple structs (JSON
/// arrays). The schema (`framework/schema/component.schema.json`) is the
/// portable surface and mandates the maps, so these helpers override glam's
/// impl on every DVec3/DQuat field.
mod vec_serde {
    use glam::{DQuat, DVec3};
    use serde::ser::SerializeStruct;
    use serde::{Deserialize, Deserializer, Serializer};

    #[derive(Deserialize)]
    struct Vec3Map {
        x: f64,
        y: f64,
        z: f64,
    }

    #[derive(Deserialize)]
    struct QuatMap {
        x: f64,
        y: f64,
        z: f64,
        w: f64,
    }

    pub mod dvec3 {
        use super::*;

        pub fn serialize<S: Serializer>(v: &DVec3, s: S) -> Result<S::Ok, S::Error> {
            let mut st = s.serialize_struct("DVec3", 3)?;
            st.serialize_field("x", &v.x)?;
            st.serialize_field("y", &v.y)?;
            st.serialize_field("z", &v.z)?;
            st.end()
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<DVec3, D::Error> {
            let m = Vec3Map::deserialize(d)?;
            Ok(DVec3::new(m.x, m.y, m.z))
        }
    }

    pub mod dquat {
        use super::*;

        pub fn serialize<S: Serializer>(q: &DQuat, s: S) -> Result<S::Ok, S::Error> {
            let mut st = s.serialize_struct("DQuat", 4)?;
            st.serialize_field("x", &q.x)?;
            st.serialize_field("y", &q.y)?;
            st.serialize_field("z", &q.z)?;
            st.serialize_field("w", &q.w)?;
            st.end()
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<DQuat, D::Error> {
            let m = QuatMap::deserialize(d)?;
            Ok(DQuat::from_xyzw(m.x, m.y, m.z, m.w))
        }
    }
}

/// Position / rotation / scale of an entity.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    #[serde(with = "vec_serde::dvec3")]
    pub position: DVec3,
    #[serde(with = "vec_serde::dquat")]
    pub rotation: DQuat,
    #[serde(with = "vec_serde::dvec3")]
    pub scale: DVec3,
}

/// Linear + angular velocity.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Velocity {
    #[serde(with = "vec_serde::dvec3")]
    pub linear: DVec3,
    #[serde(with = "vec_serde::dvec3")]
    pub angular: DVec3,
}

/// Hit points.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Health {
    pub current: f64,
    pub max: f64,
}

/// Collider shape. Serializes lowercase per the schema enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShapeKind {
    Box,
    Sphere,
    Capsule,
}

/// Physics collider. `size`: box `[hx,hy,hz]`, sphere `[r]`,
/// capsule `[r, half_height]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Collider {
    pub shape: ShapeKind,
    #[serde(rename = "size")]
    pub size: Vec<f64>,
    #[serde(rename = "isTrigger")]
    pub is_trigger: bool,
}

/// Render attachment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Renderable {
    pub mesh_ref: String,
    pub material_ref: String,
    pub visible: bool,
}

/// Behavior script attachment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Script {
    pub behavior_id: String,
    pub params: serde_json::Value,
}

/// Marks the player-controlled entity (TS `Input`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct InputMarker {
    pub marker: bool,
}

/// AI brain attachment (TS `AI`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIComp {
    pub brain_id: String,
    pub blackboard: serde_json::Value,
}

/// Time-to-live in seconds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Lifetime {
    pub remaining: f64,
}

/// Collectible effect (TS `Pickup`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickupComp {
    pub effect_id: String,
    pub value: f64,
}

/// Projectile state (TS `Projectile`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectileComp {
    pub damage: f64,
    pub owner_id: u32,
    pub piercing: bool,
}

/// Marker: this entity is the player. Serializes as JSON null.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Player;

/// Marker: this entity is an enemy. Serializes as JSON null.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Enemy;
