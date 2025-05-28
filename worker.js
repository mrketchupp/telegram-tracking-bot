// worker.js - Telegram Tracking Bot para Cloudflare Workers
// Versión Final con HTML formatting
// Fecha: 28 de mayo 2025

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    try {
      // Endpoint para configurar webhook
      if (url.pathname === '/setup-webhook' && request.method === 'GET') {
        return await setupWebhook(request, env);
      }
      
      // Webhook endpoint para recibir updates de Telegram
      if (url.pathname === '/webhook' && request.method === 'POST') {
        const update = await request.json();
        await handleTelegramUpdate(update, env, ctx);
        return new Response('OK', { status: 200 });
      }
      
      // Endpoint de verificación
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response('🚚 Telegram Tracking Bot está activo!\n\nPara configurar el webhook, visita: /setup-webhook', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
      
      return new Response('Endpoint no encontrado', { status: 404 });
      
    } catch (error) {
      console.error('Error en fetch handler:', error);
      return new Response('Error interno del servidor', { status: 500 });
    }
  },
};

// Configurar webhook de Telegram
async function setupWebhook(request, env) {
  try {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return new Response('❌ Error: TELEGRAM_BOT_TOKEN no está configurado', { status: 500 });
    }
    
    const webhookUrl = `${new URL(request.url).origin}/webhook`;
    const telegramApiUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`;
    
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: webhookUrl,
        max_connections: 100,
        allowed_updates: ['message']
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      return new Response(`✅ Webhook configurado exitosamente!

🔗 URL: ${webhookUrl}
📊 Estado: ${result.description}
🤖 Bot: Activo y listo

🎯 Prueba enviando /start en Telegram`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    } else {
      return new Response(`❌ Error: ${result.description}`, {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  } catch (error) {
    console.error('Error en setupWebhook:', error);
    return new Response(`⚠️ Error: ${error.message}`, { status: 500 });
  }
}

// Manejar updates de Telegram
async function handleTelegramUpdate(update, env, ctx) {
  // Verificar que sea un mensaje de texto
  if (!update.message || !update.message.text) {
    return;
  }
  
  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  const userName = update.message.from.first_name || 'Usuario';
  
  console.log(`Mensaje recibido de ${userName} (${chatId}): ${text}`);
  
  try {
    if (text === '/start') {
      await handleStartCommand(chatId, userName, env);
    } else if (text === '/help') {
      await handleHelpCommand(chatId, env);
    } else if (text.startsWith('/track ')) {
      const trackingNumber = text.replace('/track ', '').trim();
      await handleTrackCommand(chatId, trackingNumber, env);
    } else if (text.match(/^\d{10,}$/)) {
      // Si es solo un número, asumir que es tracking
      await handleTrackCommand(chatId, text, env);
    } else {
      await sendMessage(chatId, '❓ Comando no reconocido. Usa /help para ver los comandos disponibles.', env);
    }
  } catch (error) {
    console.error('Error manejando update:', error);
    await sendMessage(chatId, '⚠️ Ocurrió un error procesando tu solicitud. Intenta nuevamente.', env);
  }
}

// Comando /start
async function handleStartCommand(chatId, userName, env) {
  const welcomeMessage = `👋 ¡Hola ${userName}!

🚚 <b>Bot de Tracking de Paquetes</b>

Puedo ayudarte a rastrear tus paquetes de DHL y otras paqueterías.

<b>Comandos disponibles:</b>
• /track NUMERO_GUIA - Rastrear un paquete
• /help - Mostrar ayuda

<b>Ejemplo:</b>
<code>/track 5532417763</code>

¡Envíame un número de guía para comenzar! 📦`;

  await sendMessage(chatId, welcomeMessage, env);
}

// Comando /help
async function handleHelpCommand(chatId, env) {
  const helpMessage = `🆘 <b>Ayuda - Bot de Tracking</b>

<b>Comandos:</b>
• <code>/start</code> - Iniciar el bot
• <code>/track NUMERO</code> - Rastrear paquete
• <code>/help</code> - Mostrar esta ayuda

<b>Formas de rastrear:</b>
• <code>/track 5532417763</code>
• Enviar solo el número: <code>5532417763</code>

<b>Paqueterías soportadas:</b>
• DHL Express
• FedEx
• UPS
• Y muchas más...

💡 <b>Tip:</b> Solo envía el número de guía y yo me encargo del resto.`;

  await sendMessage(chatId, helpMessage, env);
}

// Comando /track
async function handleTrackCommand(chatId, trackingNumber, env) {
  // Validar formato del número
  if (!trackingNumber || trackingNumber.length < 8) {
    await sendMessage(chatId, '❌ Número de guía inválido. Debe tener al menos 8 caracteres.', env);
    return;
  }
  
  // Enviar mensaje de "buscando..."
  await sendMessage(chatId, `🔍 Buscando información del paquete: <code>${trackingNumber}</code>

Espera un momento...`, env);
  
  try {
    const trackingInfo = await getTrackingInfo(trackingNumber, env);
    await sendMessage(chatId, trackingInfo.message, env);
  } catch (error) {
    console.error('Error en tracking:', error);
    await sendMessage(chatId, `⚠️ Error al consultar el paquete ${trackingNumber}:\n${error.message}`, env);
  }
}

// Consultar API de 17Track
async function getTrackingInfo(trackingNumber, env) {
  const apiUrl = 'https://api.17track.net/track/v2.2/gettrackinfo';
  
  try {
    // Primer intento: autodetección de carrier
    let response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        '17token': env.TRACK17_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{
        "number": trackingNumber
      }])
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Respuesta 17Track:', JSON.stringify(data, null, 2));
    
    // Verificar si hay datos aceptados
    if (data.code === 0 && data.data?.accepted?.length > 0) {
      return formatTrackingResponse(trackingNumber, data.data.accepted[0]);
    }
    
    // Si autodetección falla, probar con códigos específicos
    const carrierCodes = [2, 7041, 100842]; // DHL Express, DHL Paket, DHL Supply Chain
    
    for (const carrierCode of carrierCodes) {
      console.log(`Probando carrier code: ${carrierCode}`);
      
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          '17token': env.TRACK17_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          "number": trackingNumber,
          "carrier": carrierCode
        }])
      });
      
      if (response.ok) {
        const carrierData = await response.json();
        
        if (carrierData.code === 0 && carrierData.data?.accepted?.length > 0) {
          return formatTrackingResponse(trackingNumber, carrierData.data.accepted[0]);
        }
      }
    }
    
    // Si ningún carrier funciona
    return {
      message: `📦 <b>No se encontró información</b>

🔍 Número de guía: <code>${trackingNumber}</code>

Posibles causas:
• El número puede estar incorrecto
• El paquete aún no está en el sistema
• La paquetería no está soportada

💡 Verifica el número e intenta nuevamente en unos minutos.`
    };
    
  } catch (error) {
    console.error('Error consultando 17Track:', error);
    throw new Error(`No se pudo consultar la información: ${error.message}`);
  }
}

// Formatear respuesta de tracking
function formatTrackingResponse(trackingNumber, trackData) {
  try {
    const track = trackData.track;
    
    if (!track || !track.z0 || track.z0.length === 0) {
      return {
        message: `📦 <b>Paquete encontrado pero sin eventos</b>

🔍 Número: <code>${trackingNumber}</code>
⚠️ No hay información de seguimiento disponible aún.

Intenta nuevamente más tarde.`
      };
    }
    
    const lastEvent = track.z0[0]; // Evento más reciente
    const carrierName = getCarrierName(trackData.carrier);
    
    // Formatear fecha
    const eventDate = lastEvent.a ? formatDate(lastEvent.a) : 'Fecha no disponible';
    
    const message = `📦 <b>Información del Paquete</b>

🏢 <b>Paquetería:</b> ${carrierName}
🔍 <b>Guía:</b> <code>${trackingNumber}</code>

📍 <b>Estado actual:</b> ${lastEvent.z || 'En proceso'}
🌍 <b>Ubicación:</b> ${lastEvent.c || 'En tránsito'}
📅 <b>Fecha:</b> ${eventDate}

${lastEvent.d ? `📝 <b>Detalles:</b> ${lastEvent.d}` : ''}

⏰ <i>Consultado: ${new Date().toLocaleString('es-MX', { 
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})}</i>`;

    return { message };
    
  } catch (error) {
    console.error('Error formateando respuesta:', error);
    return {
      message: `📦 <b>Información básica</b>

🔍 Número: <code>${trackingNumber}</code>
✅ Paquete encontrado en el sistema
⚠️ Error procesando detalles completos

Intenta nuevamente o contacta soporte.`
    };
  }
}

// Obtener nombre de la paquetería
function getCarrierName(carrierId) {
  const carriers = {
    2: 'DHL',
    7041: 'DHL Paket',
    100842: 'DHL Supply Chain APAC',
    100003: 'FedEx',
    // Agregar más según necesidad
  };
  
  return carriers[carrierId] || 'Paquetería detectada automáticamente';
}

// Formatear fecha
function formatDate(dateString) {
  try {
    // 17Track devuelve fechas en formato: "2025-05-28 14:30"
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      return dateString; // Devolver original si no se puede parsear
    }
    
    return date.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return dateString;
  }
}

// Enviar mensaje a Telegram - CORREGIDO PARA HTML
async function sendMessage(chatId, text, env) {
  const telegramApiUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',  // ← CAMBIADO DE MARKDOWN A HTML
        disable_web_page_preview: true
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error enviando mensaje:', errorData);
      throw new Error(`Telegram API Error: ${errorData.description}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error en sendMessage:', error);
    throw error;
  }
}
