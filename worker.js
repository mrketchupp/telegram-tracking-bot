// worker.js - Telegram Tracking Bot para Cloudflare Workers
// Versión Final con API v2.2 de 17Track y registro automático
// Fecha: 29 de mayo 2025

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

// Consultar API de 17Track - CON REGISTRO AUTOMÁTICO
async function getTrackingInfo(trackingNumber, env) {
  const registerUrl = 'https://api.17track.net/track/v2.2/register';
  const trackUrl = 'https://api.17track.net/track/v2.2/gettrackinfo';
  
  try {
    console.log(`Registrando número: ${trackingNumber}`);
    
    // PASO 1: REGISTRAR el número de guía primero
    const registerResponse = await fetch(registerUrl, {
      method: 'POST',
      headers: {
        '17token': env.TRACK17_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{
        "number": trackingNumber
      }])
    });
    
    const registerData = await registerResponse.json();
    console.log('Respuesta registro 17Track:', JSON.stringify(registerData, null, 2));
    
    // Esperar un momento para que el sistema procese el registro
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // PASO 2: CONSULTAR la información
    console.log(`Consultando información del número registrado: ${trackingNumber}`);
    
    let response = await fetch(trackUrl, {
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
    console.log('Respuesta consulta 17Track:', JSON.stringify(data, null, 2));
    
    // Verificar si hay datos aceptados
    if (data.code === 0 && data.data?.accepted?.length > 0) {
      return formatTrackingResponse(trackingNumber, data.data.accepted[0]);
    }
    
    // Si autodetección falla, probar con códigos específicos Y registro
    const carrierCodes = [2, 7041, 100842]; // DHL Express, DHL Paket, DHL Supply Chain
    
    for (const carrierCode of carrierCodes) {
      console.log(`Registrando con carrier code: ${carrierCode}`);
      
      // Registrar con carrier específico
      const carrierRegisterResponse = await fetch(registerUrl, {
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
      
      const carrierRegisterData = await carrierRegisterResponse.json();
      console.log(`Registro carrier ${carrierCode}:`, JSON.stringify(carrierRegisterData, null, 2));
      
      // Esperar antes de consultar
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Consultar con carrier específico
      console.log(`Consultando con carrier code: ${carrierCode}`);
      
      response = await fetch(trackUrl, {
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
        console.log(`Consulta carrier ${carrierCode}:`, JSON.stringify(carrierData, null, 2));
        
        if (carrierData.code === 0 && carrierData.data?.accepted?.length > 0) {
          return formatTrackingResponse(trackingNumber, carrierData.data.accepted[0]);
        }
      }
    }
    
    // Si ningún método funciona
    return {
      message: `📦 <b>Número registrado pero sin información disponible</b>

🔍 Número de guía: <code>${trackingNumber}</code>

El número fue registrado exitosamente en el sistema, pero puede necesitar más tiempo para mostrar información de seguimiento.

💡 Intenta nuevamente en 5-10 minutos.`
    };
    
  } catch (error) {
    console.error('Error consultando 17Track:', error);
    throw new Error(`No se pudo consultar la información: ${error.message}`);
  }
}

// Formatear respuesta de tracking - ACTUALIZADA PARA API v2.2
function formatTrackingResponse(trackingNumber, trackData) {
  try {
    console.log('Formateando datos de tracking:', JSON.stringify(trackData, null, 2));
    
    // Nueva estructura de la API v2.2
    const trackInfo = trackData.track_info;
    
    if (!trackInfo) {
      return {
        message: `📦 <b>Paquete encontrado pero sin información</b>

🔍 Número: <code>${trackingNumber}</code>
⚠️ No hay información de tracking disponible.

Intenta nuevamente más tarde.`
      };
    }
    
    // Obtener información básica
    const latestStatus = trackInfo.latest_status;
    const latestEvent = trackInfo.latest_event;
    const timeMetrics = trackInfo.time_metrics;
    const provider = trackInfo.tracking?.providers?.[0]?.provider;
    const events = trackInfo.tracking?.providers?.[0]?.events || [];
    
    console.log('Eventos encontrados:', events.length);
    
    if (events.length === 0) {
      return {
        message: `📦 <b>Paquete encontrado pero sin eventos</b>

🔍 Número: <code>${trackingNumber}</code>  
⚠️ No hay información de seguimiento disponible aún.

Intenta nuevamente más tarde.`
      };
    }
    
    // Información del proveedor
    const carrierName = provider?.name || 'Paquetería detectada';
    const carrierPhone = provider?.tel || '';
    
    // Estado y ubicación actual
    const currentStatus = translateStatus(latestStatus?.status) || 'En tránsito';
    const currentLocation = latestEvent?.location || 'En tránsito';
    const lastDescription = latestEvent?.description || 'Información no disponible';
    
    // Fecha estimada de entrega
    const estimatedDelivery = timeMetrics?.estimated_delivery_date?.from || null;
    const deliveryDate = estimatedDelivery ? formatDate(estimatedDelivery) : 'No disponible';
    
    // Formatear fecha del último evento
    const lastEventDate = latestEvent?.time_iso ? formatDate(latestEvent.time_iso) : 'Fecha no disponible';
    
    // Crear el mensaje principal
    let message = `📦 <b>Información del Paquete</b>

🏢 <b>Paquetería:</b> ${carrierName}
🔍 <b>Guía:</b> <code>${trackingNumber}</code>

📍 <b>Estado actual:</b> ${currentStatus}
🌍 <b>Ubicación:</b> ${currentLocation}
📅 <b>Último evento:</b> ${lastEventDate}
📝 <b>Descripción:</b> ${lastDescription}

🚚 <b>Entrega estimada:</b> ${deliveryDate}`;

    // Agregar información de contacto si está disponible
    if (carrierPhone) {
      message += `\n📞 <b>Contacto:</b> ${carrierPhone}`;
    }
    
    // Agregar historial reciente (últimos 3-5 eventos)
    if (events.length > 1) {
      message += `\n\n📋 <b>Historial reciente:</b>`;
      
      const recentEvents = events.slice(0, Math.min(5, events.length));
      
      for (const event of recentEvents) {
        const eventDate = event.time_iso ? formatDate(event.time_iso) : 'Fecha N/A';
        const eventLocation = event.location || 'Ubicación N/A';
        const eventDesc = event.description || 'Sin descripción';
        
        message += `\n\n• <b>${eventDate}</b>
📍 ${eventLocation}
📝 ${eventDesc}`;
      }
    }
    
    // Pie del mensaje
    message += `\n\n⏰ <i>Consultado: ${new Date().toLocaleString('es-MX', { 
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

// Función auxiliar para traducir estados
function translateStatus(status) {
  const statusMap = {
    'InTransit': 'En tránsito',
    'Delivered': 'Entregado',
    'PickedUp': 'Recogido',
    'OutForDelivery': 'En reparto',
    'AvailableForPickup': 'Disponible para recoger',
    'Exception': 'Incidencia',
    'Returned': 'Devuelto'
  };
  
  return statusMap[status] || status;
}

// Obtener nombre de la paquetería - LEGACY (mantenido por compatibilidad)
function getCarrierName(carrierId) {
  const carriers = {
    2: 'DHL',
    7041: 'DHL Paket',
    100842: 'DHL Supply Chain APAC',
    100001: 'DHL Express',
    100003: 'FedEx',
    // Agregar más según necesidad
  };
  
  return carriers[carrierId] || 'Paquetería detectada automáticamente';
}

// Formatear fecha
function formatDate(dateString) {
  try {
    // 17Track API v2.2 devuelve fechas en formato ISO: "2025-05-28T14:34:00+02:00"
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

// Enviar mensaje a Telegram - HTML FORMATTING
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
        parse_mode: 'HTML',  // HTML formatting para mejor compatibilidad
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
