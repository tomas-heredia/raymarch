# Modelos de prueba

Pieza en "L" cerrada (12 vértices, 20 triángulos, volumen 4), generada con `node samples/generate-samples.js`.

| Archivo | Particularidad | Eje arriba por defecto | Bbox esperado en el editor |
|---|---|---|---|
| `l-shape.obj` | Coordenadas tal cual | Y | min (0, 0, 0) · max (2, 3, 1) |
| `l-shape.stl` | Exportado con Z arriba, como Blender | Z → se convierte a Y | min (0, 0, 0) · max (2, 3, 1) |
| `l-shape.glb` | Jerarquía padre/hijo con traslaciones | Y | min (-1, 0, -0.5) · max (1, 3, 0.5) |

Si en el STL se cambia "Eje arriba" a Y (sin conversión), el bbox pasa a min (0, -1, 0) · max (2, 0, 3).
