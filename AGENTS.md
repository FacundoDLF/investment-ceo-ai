<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PROJECT MANDATORY RULES

## 1. PROJECT KNOWLEDGE ACKNOWLEDGMENT
MANDATORY: Cada vez que inicies un trabajo, respondas a un prompt o propongas algo, DEBES empezar tu primera respuesta indicando explícitamente que has leído y revisado el archivo `PROJECT_KNOWLEDGE.md` y que estás listo para comenzar. NUNCA propongas o modifiques código sin antes cumplir con esta directiva.

**Queda terminantemente PROHIBIDO omitir este archivo y volver a cometer errores que ya hayan sido registrados en la bitácora.**

## 2. ACTUALIZACIÓN AUTOMÁTICA DE LA BITÁCORA (POST-MORTEM)
MANDATORY: Cada vez que enfrentemos un bug, error de API (como los 400/404 de Groq) o descubramos una regla de negocio oculta (como el Hedge Mode de Bybit), DEBES actualizar INMEDIATAMENTE el archivo `PROJECT_KNOWLEDGE.md` agregando el nuevo issue y su solución. 
**PROHIBICIÓN:** NUNCA debes esperar a que el usuario te pida que actualices la bitácora. Debes hacerlo de forma proactiva y automática como parte final de la resolución de cualquier problema.
