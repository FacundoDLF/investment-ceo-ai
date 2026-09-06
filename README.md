# Investment CEO AI

An autonomous AI-driven investment system capable of analyzing markets and executing trades across multiple brokers.

## 🚀 Instalación y Configuración (Clonación e Iniciación)

### 1. Clonar el repositorio
```bash
git clone <url-del-repositorio>
cd investment-ceo-ai
```

### 2. Instalar dependencias
Asegúrate de contar con Node.js v20+ instalado en tu entorno.
```bash
npm install
```

### 3. Configuración de Variables de Entorno
Crea un archivo `.env` en la raíz del proyecto basándote en el archivo de plantilla `.env.template` (si existe):
```bash
cp .env.template .env
```
Deberás configurar las siguientes credenciales:
- API Keys de los proveedores de LLMs (Groq, OpenRouter)
- API Keys de los Brokers (Bybit, Alpaca)
- (Opcional) Token de acceso (`IOL_ACCESS_TOKEN`) para operar con InvertirOnline

### 4. Inicializar la Base de Datos (Prisma)
El sistema utiliza Prisma como ORM para persistencia de datos. Asegúrate de inicializar y sincronizar la base de datos local antes del primer uso:
```bash
npx prisma generate
npx prisma db push
# O alternativamente: npx prisma migrate dev
```

### 5. Ejecución del Sistema
El proyecto expone varios puntos de entrada dependiendo del agente o estrategia que desees iniciar:
```bash
npm run ceo          # Inicia el bucle general del CEO Agent
npm run ceo:crypto   # Inicia el bucle del CEO focalizado en criptomonedas (Bybit)
npm run ceo:scrappy  # Inicia el sub-agente Scrappy (Especialista HFT / Scalping)
npm run ceo:octavio  # Inicia el sub-agente Octavio (Especialista en Opciones Financieras)
npm run ceo:iol      # Inicia el bucle de integración y operatoria con InvertirOnline
npm run chat         # Inicia un chat interactivo directo con el CEO
```

---

## 🤖 Arquitectura de Agentes y Separación de Responsabilidades

El sistema emplea una arquitectura jerárquica de múltiples agentes de Inteligencia Artificial. Esto permite aislar la toma de decisiones estratégicas a largo plazo de las ejecuciones tácticas de alta frecuencia.

### 👑 CEO Agent (El Estratega)
- **Responsabilidad:** Toma de decisiones macro y orquestación general del portafolio.
- **Funciones principales:**
  - Evalúa la situación global del mercado y el estado de la cuenta.
  - Formula la "intención de trading" (Ej. acumular un activo a largo plazo o reducir exposición de riesgo).
  - Ejecuta el **Double Validation Protocol** (`validate_trade_intent`) antes de realizar operaciones pesadas para evitar errores de saldo o límites de API.
  - En situaciones de alta incertidumbre, delega consultas complejas al **Smart Analyst Tool**, utilizando modelos de alto razonamiento profundo (vía OpenRouter) para asesorar a sus modelos más veloces.
- **Dominio:** Operaciones Spot, gestión del nivel de riesgo general y rebalanceo de cuenta.

### 📊 Quant Agent (El Analista de Datos)
- **Responsabilidad:** Recopilación, normalización y análisis técnico de Market Data.
- **Funciones principales:**
  - Se conecta a las APIs de los diferentes brokers (Bybit, Alpaca, IOL) garantizando que los precios consultados correspondan al proveedor donde se operará (*venue-aware*).
  - Filtra ruido de mercado y sintetiza el "Order Book", niveles clave (soportes/resistencias) y métricas de volumen para el CEO.
  - No ejecuta operaciones directamente; es el responsable de proveer la "verdad objetiva" del mercado.

### ⚡ Scrappy (Sub-Agente HFT / Scalper)
- **Responsabilidad:** Trading de alta frecuencia, operaciones tácticas y DCA (Dollar Cost Averaging) agresivo.
- **Funciones principales:**
  - Especializado en el mercado de derivados e iteraciones ultra-rápidas.
  - Gestiona su propio presupuesto y valida restricciones estrictas de API (como el mínimo de 5 USDT por orden en Bybit).
  - Cuenta con un **Hard Stop Loss** algorítmico integrado en el código. Si su *Drawdown* flotante alcanza `-5.00%`, activa un modo *Damage Control* forzando el cierre a mercado, saltándose la decisión del LLM para proteger el capital.

### 🎯 Octavio (Sub-Agente de Opciones Financieras)
- **Responsabilidad:** Valoración, ejecución y gestión de contratos de Opciones.
- **Funciones principales:**
  - Navega la complejidad de las opciones cripto y tradicionales (Alpaca / Bybit).
  - Es capaz de estructurar operaciones complejas como *Multi-Leg* (Spreads, Iron Condors) usando notaciones OCC.
  - Tolera mayor volatilidad, por lo que su **Hard Stop Loss** está ampliado a `-40.0%`, permitiendo absorber el *Theta Decay* propio de los contratos antes de ejecutar cortes por emergencia.

---

## 🛡️ Resiliencia y Manejo de Errores

El sistema no solo está diseñado para ganar, sino para **no romperse** ante contingencias técnicas:
- **Fallback Dual-Client de LLMs:** Las inferencias se priorizan nativamente en Groq (por latencia). Si un modelo desaparece, se alcanza el límite de rate (429) o cae el proveedor (400/404), el adaptador realiza una conmutación automática hacia OpenRouter para asegurar que el bucle de trading no se interrumpa.
- **Manejo Seguro del Hedge Mode:** Adaptadores estrictos que aplican `reduceOnly: true` para cierres de posición, evitando la apertura accidental de posiciones opuestas bajo estrés.
- **Truncado de Precisión Dinámico:** Antes de enviar operaciones, los volúmenes (`qty`) se redondean hacia abajo basándose en la métrica `qtyStep` reportada en tiempo real por el broker.

---

## 📚 Documentación Adicional

Para más información, referirse a los siguientes documentos:
- [WORKFLOW.md](./WORKFLOW.md) - Explicación detallada del bucle de ejecución, validación e iteración del sistema.
- [PROJECT_KNOWLEDGE.md](./PROJECT_KNOWLEDGE.md) - **LECTURA OBLIGATORIA.** Bitácora continua de resolución de problemas, "gotchas" de las APIs y decisiones arquitectónicas (Post-mortem).
- [CHANGELOG.md](./CHANGELOG.md) - Historial de versiones.
