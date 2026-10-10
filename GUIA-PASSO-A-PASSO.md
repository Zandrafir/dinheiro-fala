# Guia para quem não é de programação

Siga na ordem. Cada passo diz o que clicar. Se travar em qualquer um, me diga em qual número você parou e o que apareceu na tela.

## O que é cada peça
- **O bot (Dinheiro Fala)**: um programa que fica ligado 24h num computador e conversa com você no WhatsApp.
- **O app do celular (Caçador de Notificações)**: lê as notificações dos seus bancos e (1) guarda os textos para você me mandar e (2) envia cada uma para o bot.
- **O Gemini**: a inteligência do Google que dá a "voz" do dinheiro. É grátis.

## Passo 1: pegar a chave do Gemini (2 minutos)
1. No computador ou celular, abra **https://aistudio.google.com/apikey**
2. Entre com sua conta Google (a mesma do Gmail).
3. Aceite os termos se aparecerem.
4. Clique em **"Criar chave de API"** (*Create API key*). Se perguntar o projeto, escolha **"Criar chave em novo projeto"**.
5. Aparece um texto comprido: é a sua chave. Toque em **copiar**.
6. **Trate como uma senha**: não poste em conversa nem em redes sociais. Se vazar, apague a chave nessa mesma página e crie outra.

Ela só será colada num arquivo chamado `.env`, no computador do bot (Passo 5).

## Passo 2: instalar o app no celular
1. Baixe o arquivo `apk/Cacador-de-Notificacoes.apk` (pelo GitHub no celular, ou na aba **Releases** do repositório).
2. Abra o arquivo baixado. O Android vai pedir para **permitir instalar apps desta origem**: permita.
3. Abra o app **Caçador de Notificações** e toque em **"Abrir tela de acesso às notificações"**. Ache o app na lista e **ative**.
4. **Se a opção estiver cinza/bloqueada** (acontece no Android 13+ com apps instalados por arquivo): volte ao app, toque em **"Se a opção estiver bloqueada: abrir Info do app"**, toque nos **três pontinhos (⋮)** no canto de cima e em **"Permitir configurações restritas"**. Depois repita o passo 3.
5. Toque em **"Bateria: deixar sem restrição"** e escolha **"Não otimizar"** para o app. Sem isso o Android pode "matar" o app.
6. Em celulares Xiaomi, Samsung, Motorola, etc., ative também "Início automático" e "Bloquear no multitarefa" para o app.
7. **Importante:** com o celular bloqueado, o Android pode trocar o texto por "Conteúdo de notificação sensível oculto" (aconteceu no seu teste). Aí o bot não vê o valor e a compra se perde. Corrija em *Configurações → Notificações → Notificações na tela de bloqueio* (ou "Privacidade") e escolha **"Mostrar todo o conteúdo"**, e confira nos apps de banco se não há opção própria para esconder o valor.

## Se o Google Play Protect bloquear o app ("O app foi bloqueado para proteger seu dispositivo")
No Brasil o Google bloqueia apps instalados por arquivo (APK) que pedem leitura de notificações, que é exatamente o que o Caçador faz. Não é defeito do app e **não vale a pena desligar a proteção**. Caminho que funciona:
- **Para eu aprender o texto dos seus bancos:** tire **prints das notificações** (Configurações → Notificações → **Histórico de notificações**, ou puxe a barra de notificações logo depois de uma operação) e cole aqui. Pode cobrir nomes/CPF; o que importa é a frase e o valor. 3 ou 4 prints por banco bastam.
- **Para enviar as notificações ao bot:** use o **MacroDroid** ou o **Tasker**, instalados pela **Play Store** (aí não há bloqueio). O bot já aceita os dois (README, seção 8).

## Passo 3: coletar os textos reais dos bancos (para você me mandar)
1. Deixe o app instalado alguns dias, **ou** faça pequenas operações de teste (um Pix de R$ 1,00 para você mesmo, uma compra pequena no cartão).
2. Abra o app: as notificações aparecem na lista ("4. Capturas"). CPF, CNPJ, e-mails e números longos já saem escondidos.
3. Toque em **"Compartilhar / copiar para me mandar"**. O texto já fica copiado.
4. **Cole aqui na conversa comigo.** Eu ajusto o programa para ler exatamente os seus bancos.
5. Se algum banco seu **não aparecer**, desmarque **"Só apps de banco/carteira conhecidos"**, faça uma operação nesse banco, e me mande: eu descubro o nome técnico do app.

Antes de colar, dê uma olhada: se tiver algum dado seu que você não queira expor (nome de pessoa, por exemplo), pode trocar por "FULANO". O que importa é o formato da frase.

## Passo 4: o computador que fica ligado 24h (Oracle Cloud, grátis)
1. Acesse **https://www.oracle.com/br/cloud/free/** → **Comece gratuitamente**. Pede cartão só para confirmar identidade; os recursos "Always Free" não cobram.
2. No painel: **Compute → Instances → Create instance**.
   - Image: **Canonical Ubuntu 22.04**.
   - Shape: **VM.Standard.E2.1.Micro** (Always Free). Se existir a opção Ampere A1 grátis e estiver disponível, também serve.
   - Em "Add SSH keys" clique em **Generate a key pair** e **baixe a chave privada** (guarde bem, é a "chave da porta").
   - Não precisa abrir porta nenhuma.
3. Quando a máquina ficar **Running**, copie o **Public IP**.
4. Conecte nela por SSH. **Esta parte eu te guio na conversa**: me diga se você usa Windows, Mac ou só o celular, e eu passo o comando exato.
5. Já dentro do servidor, traga o projeto e rode o instalador:
   ```
   git clone https://github.com/Zandrafir/dinheiro-fala.git
   cd dinheiro-fala
   bash scripts/instalar-servidor.sh
   ```
   (Se o repositório for privado, o `git clone` pede usuário e um *token* do GitHub. Eu te explico na hora.)

## Passo 5: ligar tudo (o instalador faz quase sozinho)
O comando acima pergunta 3 coisas: **chave do Gemini**, **seu número** (`55` + DDD + número) e o **modo** (escolha `1`, dedicado). Depois ele:
1. instala o que precisa;
2. mostra um **QR Code**: no celular com o WhatsApp do bot, vá em *Configurações → Aparelhos conectados → Conectar um aparelho* e aponte a câmera;
3. deixa o bot **ligado 24h** (volta sozinho se o servidor reiniciar);
4. cria um **endereço público seguro** (Tailscale Funnel, grátis; ele abre um link para você entrar/criar a conta Tailscale e autorizar);
5. no final imprime o **endereço** e o **token** que vão no celular.

Teste: mande **`ajuda`** para o bot no WhatsApp.

## Passo 6: o celular manda as notificações (MacroDroid, pela Play Store)
1. Instale o **MacroDroid** na **Play Store** e dê a permissão de **Acesso às notificações** a ele.
2. Crie uma macro:
   - **Gatilho:** *Notificação recebida* → escolha só os apps: Nubank, Carteira Google (e outros bancos que usa).
   - **Ação:** *Requisição HTTP* → método **POST** → URL = o **endereço** que o instalador mostrou (termina em `/notificacao`).
   - **Cabeçalho:** `x-token` com o **token** do instalador.
   - **Tipo de conteúdo:** `application/json`
   - **Corpo:** `{"app":"{notification_package}","titulo":"{notification_title}","texto":"{notification}"}`
3. Bateria: deixe o MacroDroid em **Sem restrições** e ative "Início automático".
4. Faça uma compra pequena e veja a mensagem chegar no WhatsApp.

## Quando uma notificação não for entendida (o bot continua aprendendo)
O bot guarda sozinho as notificações que ele não conseguiu ler (com CPF e números longos escondidos). Quando quiser, mande **`capturas`** para ele no WhatsApp: ele devolve um texto. **Cole esse texto aqui comigo** e eu ajusto o leitor. Depois mande **`limpar capturas`**. Se uma compra for **recusada** (sem limite), ele só avisa e **não** conta como gasto.

## Perguntas rápidas

**Se eu usar um chip secundário para o bot, qualquer pessoa que mandar mensagem vira "cliente" do bot?**
Não. O bot só responde ao número que você colocou em `MEU_NUMERO`. Mensagens de qualquer outra pessoa ou grupo são ignoradas, sem resposta nenhuma, e nada delas é salvo. Para essas pessoas é como se o bot não existisse (o WhatsApp do chip continua normal, você só não vê o bot reagir).

**Qual modo escolher: `self` ou `dedicado`?**
`dedicado`, com o chip secundário. Sua conta principal fica protegida (o programa que conecta ao WhatsApp não é oficial, então existe um risco pequeno de bloqueio do número usado) e você recebe notificação de verdade no celular quando o bot fala. Use um WhatsApp (ou WhatsApp Business) instalado nesse chip.

**O bot lê minha senha ou dados do banco?**
Não. Ele só vê o texto das notificações que os bancos mostram na tela.
