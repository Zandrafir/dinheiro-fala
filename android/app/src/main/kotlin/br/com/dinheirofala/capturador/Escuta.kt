package br.com.dinheirofala.capturador

import android.app.Notification
import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/** Fica "ouvindo" as notificações do celular (precisa da permissão de Acesso às notificações). */
class Escuta : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try {
            val pacote = sbn.packageName ?: return
            if (pacote == packageName) return
            val n = sbn.notification ?: return
            if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

            val ehBanco = pacote in Bancos.pacotes
            if (Armazem.soBancos(this) && !ehBanco) return

            val extras = n.extras
            val titulo = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
            val texto = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
            if (titulo.isBlank() && texto.isBlank()) return

            val nova = Armazem.adicionar(
                this, pacote, Mascara.aplicar(titulo), Mascara.aplicar(texto), System.currentTimeMillis()
            )
            // Ao bot vai o texto original (precisa do nome/valor); só apps financeiros conhecidos.
            if (nova && ehBanco && Armazem.encaminhar(this)) Enviador.enviar(this, pacote, titulo, texto)
        } catch (e: Exception) {
            Log.e("Capturador", "erro ao tratar notificação: ${e.javaClass.simpleName}")
        }
    }

    override fun onListenerDisconnected() {
        requestRebind(ComponentName(this, Escuta::class.java))
    }
}
