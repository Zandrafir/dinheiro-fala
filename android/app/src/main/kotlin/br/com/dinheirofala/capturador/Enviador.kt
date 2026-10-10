package br.com.dinheirofala.capturador

import android.content.Context
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/** Manda a notificação para o webhook do bot (formulário, que não quebra com aspas no texto). */
object Enviador {
    private val executor = Executors.newSingleThreadExecutor()

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    fun enviar(ctx: Context, pacote: String, titulo: String, texto: String) {
        val app = ctx.applicationContext
        val url = Armazem.url(app)
        val token = Armazem.token(app)
        if (url.isBlank() || token.isBlank()) return
        executor.execute {
            val corpo = "app=${enc(pacote)}&titulo=${enc(titulo)}&texto=${enc(texto)}&timestamp=${System.currentTimeMillis()}"
            var ok = false
            for (tentativa in 1..3) {
                if (post(url, token, corpo) in 200..299) { ok = true; break }
                try { Thread.sleep(tentativa * 3000L) } catch (e: InterruptedException) { break }
            }
            val hora = SimpleDateFormat("dd/MM HH:mm", Locale("pt", "BR")).format(Date())
            Armazem.setUltimoEnvio(app, if (ok) "✔ enviado em $hora" else "✘ falhou em $hora (confira o endereço e o token)")
        }
    }

    /** Retorna o código HTTP, ou -1 se não conseguiu conectar. */
    private fun post(url: String, token: String, corpo: String): Int {
        var c: HttpURLConnection? = null
        return try {
            c = URL(url).openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = 10_000
            c.readTimeout = 20_000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
            c.setRequestProperty("x-token", token)
            c.outputStream.use { it.write(corpo.toByteArray(Charsets.UTF_8)) }
            c.responseCode
        } catch (e: Exception) {
            -1
        } finally {
            c?.disconnect()
        }
    }

    /** Teste do botão "Testar conexão": roda fora da tela principal e devolve uma frase pronta. */
    fun testar(url: String, token: String, aoTerminar: (String) -> Unit) {
        executor.execute {
            if (url.isBlank() || token.isBlank()) { aoTerminar("Preencha o endereço e o token primeiro."); return@execute }
            val codigo = post(url, token, "app=teste")
            aoTerminar(
                when (codigo) {
                    400 -> "✔ Conexão e token OK! O bot está te ouvindo."
                    401 -> "✘ O bot respondeu, mas o token está errado."
                    in 200..299 -> "✔ Conexão OK."
                    -1 -> "✘ Não consegui falar com o bot. Confira o endereço (https://…/notificacao) e a internet."
                    else -> "✘ O bot respondeu com erro $codigo."
                }
            )
        }
    }
}
