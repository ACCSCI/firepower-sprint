# 3D model assets

The optimized runtime models in `public/models/` were generated specifically for this browser game with Tencent Hunyuan 3D Rapid on 2026-09-01.

Included assets: a sci-fi rifle, gatling gun, mechanical demon Boss, armored chase car, light fighter aircraft, and compact combat submarine.

Runtime preparation:

- GLB / glTF 2.0 shipping format
- Single self-contained PBR asset per file
- Mesh simplification to roughly 20–22% of source geometry
- Embedded textures resized to 512–768 px and transcoded to WebP
- Materials and accessors deduplicated and unused data pruned with glTF Transform
- No geometry compression extension, keeping loading compatible without an extra Draco/Meshopt decoder

The game loads these models asynchronously and retains procedural Three.js models as a fallback when an asset is unavailable or still loading.
