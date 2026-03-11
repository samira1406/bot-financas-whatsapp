import baileys from "@whiskeysockets/baileys"
import P from "pino"
import qrcode from "qrcode-terminal"
import fs from "fs-extra"

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = baileys

const caminhoDB = "./database/dados.json"

const GRUPO_PERMITIDO = "120363408102479565@g.us"

const nomesUsuarios = {
    "239972909056127": "Samira",
    "272327149391946": "Murilo"
}

const palavrasEntrada = ["salario", "extra", "freela", "bonus"]

async function carregarDados() {

    if (!await fs.pathExists(caminhoDB)) {

        const inicial = {
            usuarios: {}
        }

        await fs.outputJson(caminhoDB, inicial, { spaces: 2 })
        return inicial
    }

    return await fs.readJson(caminhoDB)
}

async function salvarDados(dados) {
    await fs.writeJson(caminhoDB, dados, { spaces: 2 })
}

function obterNomeUsuario(jid) {

    const numero = jid.split("@")[0]

    if (nomesUsuarios[numero]) return nomesUsuarios[numero]

    return numero
}

function obterMesAtual() {

    const data = new Date()

    return `${data.getMonth() + 1}-${data.getFullYear()}`
}

async function iniciarBot() {

    const { state, saveCreds } = await useMultiFileAuthState("auth")

    const { version } = await fetchLatestBaileysVersion()

    console.log("Versão WA:", version)

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: "silent" }),
        version,
        browser: ["Windows", "Chrome", "120.0.0"]
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", (update) => {

        const { connection, qr, lastDisconnect } = update

        if (qr) {

            console.log("\nEscaneie o QR:\n")
            qrcode.generate(qr, { small: true })

        }

        if (connection === "open") {

            console.log("✅ Bot conectado")

        }

        if (connection === "close") {

            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

            if (shouldReconnect) {

                console.log("🔄 Reconectando...")
                iniciarBot()

            } else {

                console.log("❌ Sessão encerrada")

            }

        }

    })

    sock.ev.on("messages.upsert", async ({ messages }) => {

        const msg = messages[0]

        if (!msg.message) return
        if (msg.key.fromMe) return

        const from = msg.key.remoteJid

        if (from !== GRUPO_PERMITIDO) return

        const sender = msg.key.participant || from

        const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            ""

        const mensagem = text.toLowerCase().trim()

        const dados = await carregarDados()

        const usuario = obterNomeUsuario(sender)

        if (!dados.usuarios[usuario]) {

            dados.usuarios[usuario] = {
                entradas: [],
                gastos: []
            }

        }

        const partes = mensagem.split(" ")

        if (mensagem === "comandos") {

            await sock.sendMessage(from, {
                text:
`📋 COMANDOS

Registrar gasto:
ex: uber 30

Registrar entrada:
ex: salario 5000

Ver relatório:
relatorio`
            })

            return
        }

        if (mensagem === "relatorio") {

            const mes = obterMesAtual()

            let totalEntradas = 0
            let totalGastos = 0

            for (const user in dados.usuarios) {

                const u = dados.usuarios[user]

                const entradasMes = u.entradas.filter(e => e.mes === mes)
                const gastosMes = u.gastos.filter(g => g.mes === mes)

                entradasMes.forEach(e => totalEntradas += e.valor)
                gastosMes.forEach(g => totalGastos += g.valor)

            }

            const saldo = totalEntradas - totalGastos

            await sock.sendMessage(from, {
                text:
`📊 RELATÓRIO

Entradas: R$${totalEntradas}
Gastos: R$${totalGastos}
Saldo: R$${saldo}`
            })

            return
        }

        const nome = partes[0]
        const valor = parseFloat(partes[1])

        if (isNaN(valor)) return

        const mes = obterMesAtual()

        if (palavrasEntrada.includes(nome)) {

            dados.usuarios[usuario].entradas.push({
                nome,
                valor,
                mes
            })

            await salvarDados(dados)

            await sock.sendMessage(from, {
                text: `💰 Entrada registrada: ${nome} R$${valor}`
            })

            return
        }

        dados.usuarios[usuario].gastos.push({
            nome,
            valor,
            mes
        })

        await salvarDados(dados)

        await sock.sendMessage(from, {
            text: `💸 Gasto registrado: ${nome} R$${valor}`
        })

    })

}

iniciarBot()