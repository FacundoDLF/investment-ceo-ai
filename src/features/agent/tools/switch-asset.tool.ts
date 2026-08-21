import { z } from 'zod';
import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { StateService } from '../services/state.service';

export const switchAssetTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'switch_monitored_asset',
    description: 'Cambia el criptoactivo que el sistema (Quant Agent y CEO) está analizando en tiempo real. Usalo cuando el activo actual no presente oportunidades y el Market Scanner indique una mejor opción.',
    parameters: {
      type: 'object',
      properties: {
        newAsset: { 
          type: 'string', 
          description: 'El símbolo del nuevo activo a monitorear (ej. ETHUSDT, SOLUSDT, DOGEUSDT).'
        }
      },
      required: ['newAsset']
    }
  }
};

export async function executeSwitchAsset(args: string): Promise<any> {
  try {
    const parsedArgs = JSON.parse(args);
    
    const schema = z.object({
      newAsset: z.string().describe('El símbolo del nuevo activo')
    });
    
    const validated = schema.parse(parsedArgs);
    
    StateService.setCurrentCryptoAsset(validated.newAsset);
    
    return {
      success: true,
      message: `El sistema ha cambiado exitosamente su enfoque a ${validated.newAsset}. El Quant Agent lo analizará en la próxima iteración.`
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Error al cambiar el activo: ${error.message}`
    };
  }
}
