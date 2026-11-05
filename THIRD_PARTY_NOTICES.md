# Third-party notices

Computer Bridge uses selected source files from DeepSeek Harness under the MIT
license. The upstream copyright, license and exact source hashes are preserved
in `src/computer_bridge/native/third_party/dsh/LICENSE` and
`src/computer_bridge/native/UPSTREAM.json`.

Work Tree is a separate product. This repository contains an optional connection
module, not the Work Tree implementation or its research projects.

The bundled HTML converter includes Turndown and the Joplin GFM plugin (MIT), and
Domino (BSD-2-Clause). Their complete license texts are preserved under
`src/computer_bridge/native/licenses/`. Runtime dependencies installed through npm
or pip retain their own package licenses.

Server and update-executor JavaScript bundles include complete license texts for
their bundled npm dependencies at the end of each file. Standalone Cloudflare
and server-module release files carry those notices in the file itself. ZIP
resources include the Computer Bridge MIT license and these notices; optional
Python module wheels include them in their distribution metadata.

The terminal chat interface uses prompt_toolkit 3.0.53 (BSD-3-Clause,
copyright Jonathan Slenders) and wcwidth 0.9.4 (MIT, copyright Jeff Quast,
with the additional Markus Kuhn permission notice included by upstream).
They are installed from their Python distributions, which retain the complete
license texts in their distribution metadata. Sources:
https://github.com/prompt-toolkit/python-prompt-toolkit and
https://github.com/jquast/wcwidth.

The server's MCP event delivery uses standardwebhooks 1.1.1. Its npm metadata
declares MIT while the upstream repository distributes the Apache License 2.0;
the exact upstream license and provenance are preserved in
`gateway/licenses/standardwebhooks-1.1.1.txt` and appended to server bundles.
Incremental attachment digests use @noble/hashes under MIT; bundled notices
are included by the same build process.

Chat Markdown uses markdown-it (MIT), markdown-it-texmath (MIT), highlight.js
(BSD-3-Clause), MathJax 4.1.3 and the MathJax TeX SVG font (Apache-2.0).
The browser renderer and local SVG preview bundle carry complete dependency
licenses. MathJax font provenance and license are in
`gateway/licenses/mathjax-tex-font-4.1.3.txt`.

Terminal presentation uses markdown-it-py 4.2.0 (MIT), mdit-py-plugins 0.6.1
(MIT), mdurl 0.1.2 (MIT), Pygments 2.21.0 (BSD-2-Clause), and TeXicode 1.0.5
(MIT, Darcy Zhang; https://github.com/dxddxx/TeXicode). Their license texts
are included under `src/computer_bridge/licenses/`. The terminal adapter
does not modify TeXicode or evaluate mathematical expressions.
