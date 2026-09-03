import * as fs from 'fs';
import * as path from 'path';
import type { IVenueAdapter, BalanceBreakdown, OrderParams, Position } from '../../shared/interfaces/venue.adapter';
import { LOG_PREFIX } from '../../shared/constants/colors';
import { getEstadoCuenta, getPortafolioArgentina, getOpciones, getPanelOpciones } from './iol.api';

export class IolAdapter implements IVenueAdapter {
  public readonly protocol = 'HTTP / REST API V2';
  
  async getCapabilities(): Promise<string[]> {
    return ['READ_ONLY', 'ARGENTINE_MARKET'];
  }

  async getAvailableBalance(): Promise<BalanceBreakdown> {
    console.log(`${LOG_PREFIX.IOL_API} Consultando saldos líquidos...`);
    const resp = await getEstadoCuenta();
    
    let cashArs = 0;
    if (resp.cuentas && resp.cuentas.length > 0) {
       // Buscar cuenta en pesos argentinos
       const cuentaPesos = resp.cuentas.find((c: any) => c.moneda === 'peso_Argentino') || resp.cuentas[0];
       cashArs = cuentaPesos.disponible || 0;
    }
    
    return {
      cash: cashArs, // Dejamos en ARS por ser mercado local
      dayTradingPower: 0,
      overnightPower: 0,
      marginMultiplier: 1,
      coins: [] 
    };
  }

  async getMarketPrice(symbol: string): Promise<{ bid: number; ask: number; fundingRate?: number }> {
    return { bid: 0, ask: 0 }; // TODO: Implementar endpoint Cotizacion
  }

  async getInstrumentInfo(symbol: string): Promise<{ qtyStep: number; minOrderQty: number }> {
    return { qtyStep: 1, minOrderQty: 1 };
  }

  async executeOrder(params: OrderParams): Promise<any> {
    const isTradingEnabled = process.env.IOL_ENABLE_TRADING === 'true';
    if (!isTradingEnabled) {
      throw new Error(`Feature Flag desactivado: Operación prohibida. El entorno IOL está configurado en MODO LECTURA ESTRICTO.`);
    }
    
    // Si el flag estuviera activo, validaríamos (validate_order) y luego ejecutaríamos (place_order)
    throw new Error("IOL_ENABLE_TRADING is true, but place_order is not fully implemented yet.");
  }

  async executeCashOut(amount: number, destination: string): Promise<string> {
    throw new Error("Cash Out no está soportado vía API para IOL.");
  }

  async getOptionsChain(baseCoin: string): Promise<any[]> {
    console.log(`${LOG_PREFIX.IOL_API} Solicitando cadena de opciones para ${baseCoin}...`);
    try {
      let resp;
      if (baseCoin === 'ALL') {
        resp = await getPanelOpciones();
      } else {
        resp = await getOpciones('bCBA', baseCoin);
      }
      
      // Dump raw json para debuguear estructura exacta
      try {
        const debugPath = path.join(process.cwd(), `iol_debug_opciones_${baseCoin}.json`);
        fs.writeFileSync(debugPath, JSON.stringify(resp, null, 2));
      } catch(e) {}

      // Asumimos que devuelve un array directamente o dentro de alguna propiedad (ej. resp.opciones)
      const opcionesRaw = Array.isArray(resp) ? resp : (resp.titulos || resp.opciones || []);
      
      return opcionesRaw.map((opt: any) => {
        return {
          symbol: opt.simbolo || opt.ticker || 'UNKNOWN',
          bid1Price: (opt.puntas && opt.puntas.length > 0) ? String(opt.puntas[0].precioCompra || 0) : String(opt.ultimoPrecio || 0),
          ask1Price: (opt.puntas && opt.puntas.length > 0) ? String(opt.puntas[0].precioVenta || 0) : String(opt.ultimoPrecio || 0),
          volume24h: String(opt.volumen || opt.cantidadOperaciones || 0),
          markIv: '0', delta: '0', gamma: '0', vega: '0', theta: '0'
        };
      });
    } catch (error) {
      console.error(`${LOG_PREFIX.IOL_API} Error al obtener opciones:`, error);
      return [];
    }
  }

  async getOpenPositions(): Promise<Position[]> {
    console.log(`${LOG_PREFIX.IOL_API} Sincronizando portafolio de activos locales...`);
    const resp = await getPortafolioArgentina();
    
    // Dump para debuguear los nombres de propiedades de la API de IOL V2
    try {
      const debugPath = path.join(process.cwd(), 'iol_debug_positions.json');
      fs.writeFileSync(debugPath, JSON.stringify(resp, null, 2));
    } catch(e) {}

    const activos = resp.activos || [];
    return activos.map((a: any) => {
      const symbol = a.titulo?.simbolo || a.ticker || "UNKNOWN";
      return {
        symbol: symbol,
        qty: a.cantidad,
        side: 'buy',
        marketValue: a.valorizado,
        unrealizedPl: a.gananciaDinero || a.gananciaPerdida || 0,
        unrealizedPlPc: (a.gananciaPorcentaje || a.variacionDiaria || 0) / 100,
        currentPrice: a.ultimoPrecio,
        avgEntryPrice: a.precioPromedio || (a.ultimoPrecio - (a.gananciaDinero / a.cantidad))
      };
    });
  }

}
