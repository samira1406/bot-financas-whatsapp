import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} from "@whiskeysockets/baileys"

import P from "pino"
import qrcode from "qrcode-terminal"
import fs from "fs-extra"

const caminhoDB = "./database/dados.json"

const GRUPO_PERMITIDO = "120363408102479565@g.us"

async function carregarDados() {

    if (!await fs.pathExists(caminhoDB)) {

        const inicial = {
            usuarios: {}
        }

        await fs.writeJson(caminhoDB, inicial, { spaces: 2 })
        return inicial
    }

    return await fs.readJson(caminhoDB)
}

async function salvarDados(dados) {
    await fs.writeJson(caminhoDB, dados, { spaces: 2 })
}

function obterNomeUsuario(jid) {
    return jid.split("@")[0]
}

function obterMesAtual() {

    const data = new Date()

    return `${data.getMonth() + 1}-${data.getFullYear()}`
}

async function iniciarBot() {

    const { state, saveCreds } = await useMultiFileAuthState("auth")
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: "silent" })
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", (update) => {

        const { connection, qr, lastDisconnect } = update

        if (qr) {

            console.log("\n📱 Escaneie o QR Code:\n")

            qrcode.generate(qr, { small: true })
        }

        if (connection === "open") {
            console.log("\n✅ Bot conectado ao WhatsApp\n")
        }

        if (connection === "close") {

            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

            console.log("Conexão fechada")

            if (shouldReconnect) iniciarBot()
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
                saldo: 0,
                gastos: [],
                entradas: []
            }

        }

        const user = dados.usuarios[usuario]

        console.log(usuario, ":", mensagem)

        // SALDO
        if (mensagem === "saldo") {

            await sock.sendMessage(from, {
                text: `💰 Seu saldo atual: R$${user.saldo}`
            })

            return
        }

        // RELATORIO
        if (mensagem === "relatorio") {

            const mes = obterMesAtual()

            const gastosMes = user.gastos.filter(g => g.mes === mes)
            const entradasMes = user.entradas.filter(e => e.mes === mes)

            let totalGastos = 0
            let totalEntradas = 0

            gastosMes.forEach(g => totalGastos += g.valor)
            entradasMes.forEach(e => totalEntradas += e.valor)

            let texto = `📊 RELATÓRIO DO MÊS\n\n`

            texto += `💰 Entradas:\n`

            entradasMes.forEach(e => {
                texto += `+ ${e.nome} R$${e.valor}\n`
            })

            texto += `\n💸 Gastos:\n`

            gastosMes.forEach(g => {
                texto += `- ${g.nome} R$${g.valor}\n`
            })

            texto += `\n💵 Total entradas: R$${totalEntradas}`
            texto += `\n💸 Total gastos: R$${totalGastos}`
            texto += `\n\nSaldo atual: R$${user.saldo}`

            await sock.sendMessage(from, { text: texto })

            return
        }

        const partes = mensagem.split(" ")

        const nome = partes[0]
        const valor = parseFloat(partes[1])

        const mes = obterMesAtual()

        // SALARIO
        if (nome === "salario" && !isNaN(valor)) {

            user.saldo += valor

            user.entradas.push({
                nome,
                valor,
                mes
            })

            await salvarDados(dados)

            await sock.sendMessage(from, {
                text: `💰 Salário registrado: R$${valor}\nSaldo atual: R$${user.saldo}`
            })

            return
        }

        // GASTO
        if (!isNaN(valor)) {

            user.saldo -= valor

            user.gastos.push({
                nome,
                valor,
                mes
            })

            await salvarDados(dados)

            await sock.sendMessage(from, {
                text: `🧾 Gasto registrado: ${nome} R$${valor}\nSaldo atual: R$${user.saldo}`
            })

        }

    })

}

iniciarBot()