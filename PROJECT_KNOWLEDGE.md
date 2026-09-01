# Bitácora de Conocimiento y Reglas del Proyecto (PROJECT_KNOWLEDGE)

> **⚠️ OBLIGATORIO PARA CUALQUIER AGENTE AI / DESARROLLADOR:**
> Antes de proponer una solución arquitectónica, modificar flujos de trading, o alterar la configuración de LLMs y Brokers, **DEBES LEER ESTE DOCUMENTO**. Contiene problemas resueltos, decisiones críticas y "gotchas" del entorno. No repitas errores del pasado.

---

## 1. LLMs, Modelos y Proveedores (Groq vs OpenRouter)

### [ISSUE] Error 400/404 ModelNotFound por desaparición de `llama-3.3-70b-versatile` en Groq/Proxy

* **Contexto:** El modelo del CEO estaba configurado para usar `llama-3.3-70b-versatile` a través de Groq.
* **Problema:** El proveedor (o el proxy VestAuth) dejó de soportar este modelo, arrojando un error `404 {"error":{"message":"The model llama-3.3-70b-versatile does not exist or you do not have access to it."}}`, causando múltiples fallbacks en cascada.
* **Solución:** Se corrió el script de utilidades `list_models.ts` para verificar los modelos vigentes y se modificó `src/shared/constants/models.ts` para sustituir `llama-3.3-70b-versatile` por `openai/gpt-oss-120b` (que está disponible y testeado) como modelo principal gratuito del CEO.
* **REGLA:** Ante errores 404 continuos de un modelo que antes funcionaba, no insistas. Usa el script de listar modelos para ver la oferta actual en el endpoint y cambia el `id` del modelo inmediatamente.

### [ISSUE] Error 400/404 ModelNotFound al usar Llama en OpenRouter o Groq

* **Contexto:** Se implementó una lógica de fallback para que el CEO Trader no fallara si un modelo de IA estaba caído.
* **Problema:** Al enviar modelos como `llama-3.3-70b-versatile` a través de la URL de OpenRouter (o viceversa con Claude en Groq), el servidor respondía con error 404. Posteriormente descubrimos que en entornos de proxy mockeados (ej. `VestAuth`), tampoco están disponibles los modelos nativos de Groq ni `claude-3.5-sonnet`.
* **Solución (Arquitectura Dual-Client y Fallback Seguro):**
  En `src/shared/lib/groq.ts` se implementó:
  * `nativeGroqClient`: Se conecta nativamente a Groq.
  * `openRouterClient`: Se conecta a OpenRouter.
  **Además, se priorizaron modelos como `meta-llama/llama-3.3-70b-instruct` y `qwen/qwen-2.5-72b-instruct`** que SÍ sabemos que devuelven Status 200 en el Proxy actual.
* **REGLA:** El enrutamiento es automático basándose en el nombre del modelo. **Si el modelo tiene una barra diagonal `/` (ej: `meta-llama/...`), viaja por OpenRouter. Si no la tiene, viaja por Groq nativo.** NUNCA cambies esta lógica sin una razón justificada. Y si usas un Proxy, verifica con un script (`list_models.ts` o fetch) que el modelo realmente exista antes de codearlo duro.

### [ISSUE] ModelNotFound/Unsupported (400/404) por Modelos Deprecados en Groq

* **Contexto:** Groq y otras APIs actualizan o deprecian modelos frecuentemente (ej. `gemma2-9b-it` deprecado, `llama3-8b-8192` removido en algunos endpoints).
* **Problema:** El sistema reintentaba infinitamente (o escupía errores en loop en Daemons HFT como Scrappy) porque los IDs de los modelos ya no existían o devolvían Error 400 Bad Request.
* **Solución:**
  1. Se configuró `groq.ts` para capturar errores 400/404 y registrar el fallo en `error_postmortem.json` para facilitar la depuración, y añadir el modelo a un `permanentlyFailedModels` Set, impidiendo que bloquee futuros ciclos en Daemons HFT.
  2. Para evitar crasheos completos, se actualizó la lista de fallbacks en los agentes utilizando modelos que se verificó que existen en el endpoint actual mediante el script `list_models.ts`.
* **REGLA:** Siempre incluye múltiples `fallbackModels` en llamadas críticas (`createChatCompletionWithRetry`) y, si hay un fallo masivo de modelos, verifica inmediatamente el endpoint usando el script de listar modelos para ver la nueva oferta real.

### [ISSUE] Daemon crashea al agotar saldo de OpenRouter (Error 402 Payment Required)

* **Contexto:** Cuando la cuenta de OpenRouter se queda sin créditos, la API devuelve HTTP 402.
* **Problema:** El sistema de Fallback (`groq.ts`) estaba asumiendo que el 402 era un modelo no soportado (`ModelNotFound/Unsupported`). Metía todos los modelos en la lista negra (`permanentlyFailedModels`) intentando hacer fallback iterativamente, y finalmente crasheaba todo el Daemon lanzando el error: "Todos los modelos fallaron permanentemente".
* **Solución:** En `groq.ts` se añadió un manejo explícito para el Status 402. Si se detecta un 402, el script ahora lanza un `throw new Error("API Key sin fondos (402 Payment Required)...")` **inmediatamente**, en lugar de intentar fallbacks y enmascarar el error original.
* **REGLA:** Nunca silencies un error 402. Si la cuenta no tiene fondos, no tiene sentido reintentar con otros modelos del mismo proveedor. Aborta rápido y avisa al usuario.

### [DECISIÓN] Consulta a Modelos "Smart" (Consult Analyst Tool)

* **Contexto:** Llama 70B en Groq es ultra rápido (ideal para High Frequency Trading), pero a veces carece del razonamiento profundo.
* **Solución:** Se creó la herramienta `consult_smart_analyst`. Llama 70B tiene permiso para invocarla si el mercado es ambiguo. Esto envía el contexto por debajo a OpenRouter y le devuelve el consejo estratégico a Llama.

### [ISSUE] Error 400 (spend_limit_reached) en Groq y 402 en OpenRouter (Blackout Total)

* **Contexto:** Durante la ejecución, Groq puede bloquear la API si se alcanza el umbral de alerta de gasto (`spend_limit_reached`), devolviendo un HTTP 400.
* **Problema:** El sistema realiza correctamente el fallback a OpenRouter, pero si la cuenta de OpenRouter también está sin fondos (402), el sistema se queda sin ningún modelo disponible, provocando un "Blackout total" y pausando la ejecución por 120s (o abortando, dependiendo de la capa que capture el 402).
* **Solución (Operativa):** Esto no es un bug del código. Requiere que el administrador intervenga recargando saldo o ajustando el límite de gasto en la consola de Groq (<https://console.groq.com/settings/billing>) y OpenRouter.
* **REGLA:** Ante un "Blackout total" por falta de fondos combinada, notifica al usuario que ambas fuentes (nativa y fallback) se han quedado sin saldo/límite.

---

## 2. Ejecución de Órdenes y Brokers

### [ISSUE] Bybit API Error: Qty invalid o "Data sent for paramter '' is not valid"

* **Contexto:** Al operar en Bybit (ej. `BTCUSDT`), el Quant Agent o el bot HFT Scrappy calculaban cantidades matemáticas precisas pero muy pequeñas (ej. `0.00054` o con excesivos decimales `0.12985`).
* **Problema:** Bybit rechaza cantidades con excesivos decimales si superan la regla del contrato Linear (`qtyStep`). El truncado original agresivo (`Math.floor(qty * 1000) / 1000`) provocaba que compras pequeñas de BTC terminaran siendo `0` en Spot, y hardcodear decimales causaba errores `Qty invalid` en monedas exóticas o muy baratas.
* **Solución:** En `bybit.adapter.ts` se implementó `getInstrumentInfo` que consulta el endpoint `/v5/market/instruments-info` y cachea la respuesta. En `scrappy.agent.ts`, se hace `Number((Math.floor(qty / info.qtyStep) * info.qtyStep).toFixed(precision))` para respetar milimétricamente el `qtyStep` dinámico del broker antes de enviar la orden.
* **REGLA:** NUNCA hardcodees la cantidad de decimales permitida para una orden. Siempre utiliza la API del broker para obtener el `qtyStep` dinámico del instrumento y formatea la cantidad usándolo como divisor/multiplicador.

### [ISSUE] Bybit API Error: ab not enough for new order (Hedge Mode Close)

* **Contexto:** El CEO intentaba cerrar una posición Long perdedora durante el MODO DAMAGE CONTROL.
* **Problema:** En el Hedge Mode de Bybit, para cerrar una posición no basta con enviar una orden contraria; Bybit cree que quieres ABRIR una nueva posición en la dirección opuesta (y falla si no tienes saldo libre).
* **Solución:** En `bybit.adapter.ts` y en `close-position.tool.ts` se implementó explícitamente el uso de la bandera `reduceOnly: true`. Además, la lógica del `positionIdx` en el adapter se invirtió para cierres: al cerrar un Long (vendiendo con reduceOnly), debes enviar `positionIdx = 1`. Al cerrar un Short (comprando con reduceOnly), debes enviar `positionIdx = 2`.
* **REGLA:** Siempre que diseñes herramientas o adapters para CERRAR posiciones en Hedge Mode, DEBES incluir `reduceOnly: true` en la carga útil y cruzar la orden apuntando al `positionIdx` de la posición original que intentas reducir.

### [ISSUE] Bybit API Error: orderLinkId can not be empty (Opciones)

* **Contexto:** El sub-agente Octavio intentó abrir una posición en un contrato de opciones (`category: 'option'`) en Bybit.
* **Problema:** La API de Bybit V5 exige que, al enviar órdenes de opciones, el cliente provea explícitamente un `orderLinkId` único, de lo contrario la API rechaza la petición con error.
* **Solución:** En `bybit.adapter.ts`, dentro del método `executeOrder`, se agregó una validación específica para `category === 'option'`, inyectando un `orderLinkId` dinámico (ej: `'opt_' + Date.now() + '_' + Math.random()`) antes de construir la firma criptográfica y mandar el payload.
* **REGLA:** NUNCA envíes una orden a la categoría `option` de Bybit sin incluir el parámetro `orderLinkId`.

### [ISSUE] Bybit API Error: Insufficient balance en Órdenes SPOT

* **Contexto:** El CEO Agent intentaba comprar BTCUSDT enviando una orden `category: "spot"`.
* **Problema:** La API devolvía Insufficient balance. En Bybit V5, para hacer Market Buy en Spot, la API asume que el `qty` está en *Quote Currency* (ej. USDT), por lo que $0.1884 USDT fallaba. Además, en cuentas Unified (UTA), el poder Spot a veces suma saldos como USDC, que no sirven para comprar el par BTC/USDT directamente, causando fallos impredecibles.
* **Solución (Doble Validación):** En lugar de forzar a operar en futuros, se implementó el **Protocolo de Doble Validación**. Se creó la herramienta `validate_trade_intent` que el CEO debe llamar obligatoriamente antes de ejecutar. Esta herramienta simula la orden, revisa los saldos reales (Spot o Linear) y rechaza internamente la intención si el saldo no coincide, permitiéndole al CEO corregir el tamaño de la orden (qty) o cambiar de categoría sin hacer fallar al proceso principal.
* **REGLA:** El CEO tiene libertad para operar en `spot` o `linear`, pero está **ESTRICTAMENTE OBLIGADO** a pasar por `validate_trade_intent` y luego por `consult_smart_analyst` antes de usar `execute_trade`.

### [ISSUE] Alpaca Market Data API error: 404 - no quote found for BTCUSDT

* **Contexto:** El loop del CEO tiene un modo "crypto" (`npm run start crypto`).
* **Problema:** El agente de precios (`get_market_price`) estaba intentando buscar cotizaciones de Bybit (`BTCUSDT`) en el broker de acciones Alpaca, devolviendo 404.
* **Solución:** En `ceo.loop.ts`, se le pasa explícitamente el `venue` ('bybit' o 'alpaca') a los sub-agentes en su System Prompt. El Quant Agent ahora sabe exactamente a qué exchange consultar.
* **REGLA:** Respeta el parámetro `venue` en las iteraciones de trading. No asumas que Alpaca tiene cotizaciones cripto en el formato de Bybit.

### [ISSUE] Alpaca Options API (Multi-Leg & OCC Format)

* **Contexto:** El CEO Agent ahora tiene la habilidad de operar opciones financieras en Alpaca (Fase 2).
* **Problema:** Operar opciones simples (Single-Leg) vs opciones combinadas (Multi-Leg como Spreads o Iron Condors) requiere estructuras de carga útil diferentes en la API de Alpaca. Un contrato simple usa el símbolo OCC (ej. `SPY260116C00550000`), mientras que un Multi-Leg usa `order_class: 'mleg'` y un array de `legs`.
* **Solución:** En `alpaca.adapter.ts` (método `executeOrder`), se implementó la detección de la propiedad `legs` dentro del parámetro de entrada `OrderParams`. Si `category === 'option'` y existen `legs`, se rutea la orden como un Multi-Leg.
* **REGLA:** Cuando el CEO o un sub-agente desee ejecutar una estrategia de opciones complejas (Multi-Leg) en Alpaca, **debe usar estrictamente** el parámetro `legs` en la tool `execute_trade` proveyendo los símbolos OCC y la configuración de compra/venta para cada pata, en lugar de intentar meter todo en el parámetro principal `symbol`.

---

## 3. Comportamiento y Validación del Agente

### [ISSUE] El LLM se niega a operar (Safety Refusals)

* **Contexto:** Modelos de IA base suelen rechazar peticiones de "comprar" o "vender" criptomonedas argumentando que no pueden dar asesoría financiera.
* **Problema:** Esto rompe completamente el bucle autónomo del CEO.
* **REGLA:** NUNCA edites el mandato para hacerlo más "amigable" o conversacional. Su naturaleza debe ser puramente algorítmica.

### [ISSUE] Bybit API Error: Order does not meet minimum order value 5USDT

* **Contexto:** El sub-agente Scrappy intentaba abrir posiciones o hacer DCA en Bybit.
* **Problema:** Bybit requiere que el valor de la orden (precio * cantidad) sea de al menos 5 USDT para la mayoría de los pares en derivados. Como Scrappy usaba un presupuesto fijo (budget), cuando este presupuesto era menor a 5 USDT (ej. por bajo capital general o saldo residual), la API rechazaba las órdenes arrojando `Order does not meet minimum order value 5USDT`.
* **Solución:** Se implementó una validación matemática de `orderValue = qty * currentPrice` tanto en la configuración inicial del agente (`command-scrappy.tool.ts`) como en el loop de ejecución de HFT (`scrappy.agent.ts`). Si el valor de la orden es inferior a 5 USDT, el sistema o Scrappy descartan la orden para no atacar en vano la API.
* **REGLA:** Siempre que se envíen órdenes en derivados de Bybit, se debe comprobar que el tamaño en dólares de la posición (`qty * price`) sea igual o mayor al `minOrderValue` (5 USDT) ANTES de enviarla a la API.