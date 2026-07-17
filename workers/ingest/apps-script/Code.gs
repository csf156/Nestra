/**
 * Nestra — reenvío de correos del banco al Worker de ingesta.
 *
 * Instalar UNA COPIA POR CUENTA GMAIL (César y Darling), cada una con su
 * propio TOKEN. Pasos en el README (sección "Apps Script").
 *
 * Qué hace: cada N minutos busca correos del banco sin procesar, hace POST
 * del contenido al Worker de Cloudflare y etiqueta el hilo como
 * "nestra-procesado" para no reenviarlo de nuevo.
 */

// ====== CONFIGURAR ESTOS 3 VALORES ======

// URL del Worker desplegado (termina en /ingest).
var WORKER_URL = 'https://nestra-email-ingest.TU-SUBDOMINIO.workers.dev/ingest';

// Token de ESTA cuenta. Su SHA-256 debe estar dado de alta en la tabla
// email_ingest_tokens (una fila por usuario). El Worker lo hashea y resuelve
// el user_id; no hay secrets por usuario en el Worker.
var TOKEN = 'PEGAR_TOKEN_AQUI';

// Búsqueda Gmail: ajustar remitentes del banco. Ejemplos:
//   'from:(notificaciones@bcp.com.pe OR bancadigital@interbank.pe)'
// newer_than:3d evita reprocesar historial viejo la primera vez.
var QUERY = 'from:(CAMBIAR_REMITENTE_BANCO) newer_than:3d';

// ========================================

var LABEL = 'nestra-procesado';

function procesarCorreos() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search(QUERY + ' -label:' + LABEL, 0, 20);

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    var todosOk = true;

    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      var payload = {
        messageId: msg.getId(),
        from: msg.getFrom(),
        subject: msg.getSubject(),
        date: msg.getDate().toISOString(),
        body: msg.getPlainBody().slice(0, 20000),
      };

      var resp = UrlFetchApp.fetch(WORKER_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + TOKEN },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      if (resp.getResponseCode() !== 200) {
        todosOk = false;
        console.error('Fallo POST ' + msg.getId() + ': HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText());
      }
    }

    // Solo etiquetar si todo el hilo se envió bien; si no, se reintenta
    // en la próxima ejecución.
    if (todosOk) threads[i].addLabel(label);
  }
}
