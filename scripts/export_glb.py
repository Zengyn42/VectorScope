"""Blender headless script to export .blend to .glb with Draco compression.

Usage:
  blender --background <file.blend> --python export_glb.py -- <output.glb>
"""
import bpy
import sys

# Parse args after "--"
argv = sys.argv
argv = argv[argv.index("--") + 1:]
output_path = argv[0]

# Export glTF 2.0 binary (.glb) with Draco compression
# Blender 4.x API
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_materials='EXPORT',
    export_cameras=True,
    export_lights=True,
)

print(f"Exported to: {output_path}")
