package br.com.dinheirofala.capturador

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : Activity() {

    private lateinit var status: TextView
    private lateinit var contagem: TextView
    private lateinit var lista: TextView
    private lateinit var ultimoEnvio: TextView

    // precisa ficar guardado em um campo, senão o Android descarta o "ouvinte"
    private val ouvinte = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        runOnUiThread { atualizar() }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun texto(t: String, tam: Float = 14f, negrito: Boolean = false) = TextView(this).apply {
        text = t; textSize = tam
        if (negrito) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(6), 0, dp(6))
    }

    private fun botao(t: String, acao: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false
        setOnClickListener { acao() }
    }

    private fun campo(dica: String, valor: String, senha: Boolean, aoMudar: (String) -> Unit) = EditText(this).apply {
        hint = dica; setText(valor); setSingleLine(true)
        inputType = if (senha) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) = aoMudar(s?.toString().orEmpty())
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(32))
        }
        setContentView(ScrollView(this).apply { addView(col) })

        col.addView(texto("Caçador de Notificações", 22f, true))
        col.addView(texto("Guarda as notificações dos seus apps de banco para você me mandar os textos, e (se quiser) já envia cada uma para o seu bot Dinheiro Fala."))

        // 1) permissão
        col.addView(texto("1. Permissão", 17f, true))
        status = texto("")
        col.addView(status)
        col.addView(botao("Abrir tela de acesso às notificações") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        })
        col.addView(botao("Se a opção estiver bloqueada: abrir Info do app") {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            Toast.makeText(this, "Toque nos 3 pontinhos (⋮) e em \"Permitir configurações restritas\".", Toast.LENGTH_LONG).show()
        })
        col.addView(botao("Bateria: deixar sem restrição") {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            Toast.makeText(this, "Procure \"Caçador de Notificações\" e escolha \"Não otimizar\".", Toast.LENGTH_LONG).show()
        })

        // 2) captura
        col.addView(texto("2. O que capturar", 17f, true))
        col.addView(CheckBox(this).apply {
            text = "Só apps de banco/carteira conhecidos"
            isChecked = Armazem.soBancos(this@MainActivity)
            setOnCheckedChangeListener { _, v -> Armazem.setSoBancos(this@MainActivity, v) }
        })
        col.addView(texto("Desmarque para capturar TODOS os apps. Útil para descobrir o nome técnico (pacote) de um banco que não está na lista. Depois marque de novo.", 12f))

        // 3) envio ao bot
        col.addView(texto("3. Enviar para o bot (opcional)", 17f, true))
        col.addView(campo("Endereço: https://seu-endereco/notificacao", Armazem.url(this), false) { Armazem.setUrl(this, it) })
        col.addView(campo("Token (o WEBHOOK_TOKEN do bot)", Armazem.token(this), true) { Armazem.setToken(this, it) })
        col.addView(CheckBox(this).apply {
            text = "Enviar cada notificação de banco para o bot"
            isChecked = Armazem.encaminhar(this@MainActivity)
            setOnCheckedChangeListener { _, v -> Armazem.setEncaminhar(this@MainActivity, v) }
        })
        col.addView(botao("Testar conexão com o bot") {
            Toast.makeText(this, "Testando…", Toast.LENGTH_SHORT).show()
            Enviador.testar(Armazem.url(this), Armazem.token(this)) { msg ->
                runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }
            }
        })
        ultimoEnvio = texto("", 12f)
        col.addView(ultimoEnvio)

        // 4) capturas
        col.addView(texto("4. Capturas", 17f, true))
        contagem = texto("")
        col.addView(contagem)
        col.addView(botao("Compartilhar / copiar para me mandar") { compartilhar() })
        col.addView(botao("Apagar tudo") {
            Armazem.limpar(this)
            Toast.makeText(this, "Apagado.", Toast.LENGTH_SHORT).show()
        })
        lista = texto("", 12f)
        col.addView(lista)
    }

    override fun onResume() {
        super.onResume()
        Armazem.prefs(this).registerOnSharedPreferenceChangeListener(ouvinte)
        atualizar()
    }

    override fun onPause() {
        super.onPause()
        Armazem.prefs(this).unregisterOnSharedPreferenceChangeListener(ouvinte)
    }

    private fun permissaoAtiva(): Boolean {
        val ativos = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return ativos.contains(packageName)
    }

    private fun atualizar() {
        status.text = if (permissaoAtiva()) "✔ Permissão concedida. Estou ouvindo as notificações."
        else "✘ Sem permissão ainda. Toque no botão abaixo, ache \"Caçador de Notificações\" e ative."
        ultimoEnvio.text = Armazem.ultimoEnvio(this).let { if (it.isBlank()) "" else "Último envio ao bot: $it" }

        val caps = Armazem.listar(this)
        contagem.text = "${caps.size} notificação(ões) guardada(s). Os CPF, CNPJ, e-mails e números longos ficam escondidos."
        val fmt = SimpleDateFormat("dd/MM HH:mm", Locale("pt", "BR"))
        lista.text = caps.take(30).joinToString("\n\n") {
            "[${Bancos.pacotes[it.pacote] ?: it.pacote}] ${fmt.format(Date(it.quando))}\n${it.titulo}\n${it.texto}"
        }
        lista.visibility = if (caps.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun compartilhar() {
        val json = Armazem.exportarJson(this)
        if (Armazem.listar(this).isEmpty()) {
            Toast.makeText(this, "Ainda não há nada guardado.", Toast.LENGTH_SHORT).show(); return
        }
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
            .setPrimaryClip(ClipData.newPlainText("capturas", json))
        Toast.makeText(this, "Copiado! Agora é só colar na conversa.", Toast.LENGTH_SHORT).show()
        val i = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, json)
        }
        startActivity(Intent.createChooser(i, "Enviar capturas"))
    }
}
