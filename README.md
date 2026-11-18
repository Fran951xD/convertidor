# Taller PDF

Página web para convertir documentos a PDF y desde PDF. **Todo se procesa en el navegador**: los archivos no se suben a ningún servidor. Funciona en ordenador y en móvil, y no hace falta instalar nada.

## Herramientas

| Convertir a PDF | Convertir desde PDF |
|---|---|
| JPG/PNG a PDF | PDF a JPG (150/300/600 ppp, ZIP) |
| Word (.docx) a PDF | PDF a Word (.docx) |
| PowerPoint (.pptx) a PDF | PDF a PowerPoint (idéntico o editable) |
| Excel (.xlsx/.xls) a PDF | PDF a Excel (una hoja por tabla) |
| HTML a PDF | PDF a PDF/A (1b, 2b o 3b) |

## Publicarla en GitHub Pages (para usarla desde el móvil)

1. Crea un repositorio en GitHub y sube estos archivos: `index.html`, `tests.html`, `css/`, `js/` y `README.md`.
2. En el repositorio, ve a **Settings → Pages**.
3. En «Branch» elige `main`, carpeta `/ (root)`, y pulsa **Save**.
4. Al cabo de un minuto la página estará en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`. Ábrela desde cualquier dispositivo.

Hace falta conexión a internet, porque las librerías de conversión se cargan desde CDN la primera vez que se usa cada herramienta.

## Usarla en el PC sin publicarla

No funciona haciendo doble clic en `index.html`: el navegador bloquea parte de los componentes cuando la página se abre como archivo. Arráncala con un servidor local (Python ya trae uno):

```
python -m http.server 8000
```

y abre http://localhost:8000.

## Pruebas

Abre `tests.html` (en GitHub Pages o en el servidor local). Genera sus propios archivos de prueba (un docx con tabla, imagen y encabezado; un pptx de 2 diapositivas; un xlsx de 2 hojas; un PDF con texto y tabla; un PDF escaneado) y comprueba que cada conversión produce un archivo que se abre y tiene el número de páginas, diapositivas u hojas esperado. También prueba los errores: PDF dañado, escaneado, formato falso, Office protegido y formato no válido.

## Calidad y limitaciones de cada herramienta

| Herramienta | Calidad | Limitaciones |
|---|---|---|
| JPG a PDF | Idéntica | Las imágenes se insertan sin recomprimir (las PNG, sin pérdida). Respeta la rotación de las fotos del móvil. |
| Word a PDF | Aproximada | El navegador dibuja el documento ([docx-preview](https://github.com/VolodymyrBaydalka/docxjs)). Las fuentes que no tenga el dispositivo se sustituyen. El texto del PDF queda como imagen, no seleccionable. Los saltos de página automáticos se calculan, así que pueden no coincidir con los de Word. |
| PowerPoint a PDF | Básica | Texto, imágenes, formas, tablas, gráficos y fondos sencillos. Los símbolos de viñeta y la alineación vertical de algunos cuadros de texto pueden no coincidir; efectos, SmartArt, degradados complejos y fuentes especiales pueden verse distintos. Texto no seleccionable. |
| Excel a PDF | Buena para datos | Texto seleccionable. Respeta las hojas ocultas, el área de impresión, la orientación, la escala y el ajuste a una página de ancho. Las fórmulas muestran el último valor que guardó Excel. No conserva colores de celda, bordes personalizados ni gráficos. Los caracteres fuera del alfabeto latino pueden no mostrarse. |
| HTML a PDF | Idéntica (motor del navegador) | Abre el diálogo de impresión: hay que elegir «Guardar como PDF». No admite URL, porque el navegador no deja leer otras webs. Las imágenes con rutas relativas no se cargan. |
| PDF a JPG | Idéntica | En móviles, las páginas muy grandes a 600 ppp se reducen por el límite de memoria, y la página avisa cuando ocurre. |
| PDF a Word | Aproximada | Recupera texto, tamaños, negritas, párrafos y tablas sencillas. No copia imágenes. |
| PDF a PowerPoint | Idéntico / aproximado | Idéntico: cada página como imagen (no editable). Editable: el texto en cuadros de texto en su posición, sin imágenes ni formas. |
| PDF a Excel | Buena con tablas sencillas | Detecta tablas por la alineación del texto. Si no encuentra ninguna, lo dice. Las celdas combinadas o las tablas sin columnas claras pueden salir mal. |
| PDF a PDF/A | Buena | Ghostscript compilado a WebAssembly (unos 16 MB que se descargan la primera vez). Se hace una validación básica (metadatos XMP, perfil de color, sin cifrado y fuentes incrustadas) y la página avisa si no cumple. Para una certificación formal usa [veraPDF](https://verapdf.org). |

Límites comunes: 50 MB por archivo. Los PDF protegidos con contraseña y los documentos de Office cifrados se rechazan con un mensaje claro. Los PDF escaneados (sin texto) no se pueden pasar a Word, Excel ni PowerPoint editable.

## Mejoras futuras

- OCR para PDF escaneados (por ejemplo, con Tesseract.js).
- Funcionamiento sin conexión, guardando las librerías en el propio repositorio.

## Estructura

```
index.html        portada y páginas de herramienta (rutas #/jpg-pdf, #/word-pdf, …)
css/styles.css    diseño (claro/oscuro, adaptable a móvil)
js/converters.js  las 10 conversiones y las validaciones
js/app.js         interfaz: arrastrar y soltar, progreso, vista previa, descarga
tests.html        pruebas automáticas (js/tests.js)
```

## Licencias de terceros

pdf-lib (MIT), PDF.js (Apache 2.0), JSZip (MIT), PptxGenJS (MIT), docx (MIT), docx-preview (Apache 2.0), SheetJS Community (Apache 2.0), html2canvas (MIT), jsPDF y jsPDF-AutoTable (MIT), pptx-preview (uso libre según su autor) y Ghostscript WASM (AGPL-3.0). Por usar Ghostscript, si publicas la página el código debe ser público, como ya ocurre en un repositorio público de GitHub.
