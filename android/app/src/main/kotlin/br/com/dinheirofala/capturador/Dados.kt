package br.com.dinheirofala.capturador

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** Apps financeiros conhecidos (mesmos pacotes de config/apps.js do bot). */
object Bancos {
    val pacotes = mapOf(
        "com.nu.production" to "Nubank",
        "com.itau" to "Itaú",
        "com.bradesco" to "Bradesco",
        "br.com.bb.android" to "Banco do Brasil",
        "br.com.gabba.Caixa" to "Caixa",
        "com.santander.app" to "Santander",
        "br.com.intermedium" to "Inter",
        "com.c6bank.app" to "C6 Bank",
        "com.picpay" to "PicPay",
        "com.mercadopago.wallet" to "Mercado Pago",
        "com.google.android.apps.walletnfcrel" to "Google Carteira",
    )
}

/** Esconde CPF, CNPJ, e-mail e números longos antes de guardar/compartilhar. Valores em R$ ficam. */
object Mascara {
    private val cnpj = Regex("""\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b""")
    private val cpf = Regex("""\b\d{3}\.\d{3}\.\d{3}-\d{2}\b""")
    private val email = Regex("""[\w.+-]+@[\w-]+(\.[\w-]+)+""")
    private val longo = Regex("""(?<![\d.,])\d{8,}(?!\d|,\d{2})""")

    fun aplicar(s: String): String = s
        .replace(cnpj, "**.***.***/****-**")
        .replace(cpf, "***.***.***-**")
        .replace(email, "***@***")
        .replace(longo, "********")
}

data class Captura(val pacote: String, val titulo: String, val texto: String, val quando: Long)

object Armazem {
    private const val MAX = 300

    fun prefs(c: Context): SharedPreferences =
        c.applicationContext.getSharedPreferences("capturador", Context.MODE_PRIVATE)

    fun soBancos(c: Context) = prefs(c).getBoolean("soBancos", true)
    fun setSoBancos(c: Context, v: Boolean) = prefs(c).edit().putBoolean("soBancos", v).apply()

    fun encaminhar(c: Context) = prefs(c).getBoolean("encaminhar", false)
    fun setEncaminhar(c: Context, v: Boolean) = prefs(c).edit().putBoolean("encaminhar", v).apply()

    fun url(c: Context) = prefs(c).getString("url", "") ?: ""
    fun setUrl(c: Context, v: String) = prefs(c).edit().putString("url", v.trim()).apply()

    fun token(c: Context) = prefs(c).getString("token", "") ?: ""
    fun setToken(c: Context, v: String) = prefs(c).edit().putString("token", v.trim()).apply()

    fun ultimoEnvio(c: Context) = prefs(c).getString("ultimoEnvio", "") ?: ""
    fun setUltimoEnvio(c: Context, v: String) = prefs(c).edit().putString("ultimoEnvio", v).apply()

    private fun arr(c: Context): JSONArray =
        try { JSONArray(prefs(c).getString("capturas", "[]")) } catch (e: Exception) { JSONArray() }

    /** Guarda (já mascarado). Retorna false se for repetição da última em menos de 2 minutos. */
    @Synchronized
    fun adicionar(c: Context, pacote: String, titulo: String, texto: String, quando: Long): Boolean {
        val atual = arr(c)
        val ult = atual.optJSONObject(0)
        if (ult != null && ult.optString("p") == pacote && ult.optString("t") == titulo &&
            ult.optString("x") == texto && quando - ult.optLong("q") < 120_000
        ) return false
        val novo = JSONArray()
        novo.put(JSONObject().put("p", pacote).put("t", titulo).put("x", texto).put("q", quando))
        for (i in 0 until minOf(atual.length(), MAX - 1)) novo.put(atual.get(i))
        prefs(c).edit().putString("capturas", novo.toString()).apply()
        return true
    }

    fun listar(c: Context): List<Captura> {
        val a = arr(c)
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map {
            Captura(it.optString("p"), it.optString("t"), it.optString("x"), it.optLong("q"))
        }
    }

    @Synchronized
    fun limpar(c: Context) = prefs(c).edit().putString("capturas", "[]").apply()

    /** JSON no mesmo formato de exemplos/notificacoes.json do bot (mais antigas primeiro). */
    fun exportarJson(c: Context): String {
        val saida = JSONArray()
        for (cap in listar(c).reversed()) {
            saida.put(
                JSONObject()
                    .put("_nome", Bancos.pacotes[cap.pacote] ?: cap.pacote)
                    .put("app", cap.pacote)
                    .put("titulo", cap.titulo)
                    .put("texto", cap.texto)
            )
        }
        return saida.toString(2)
    }
}
