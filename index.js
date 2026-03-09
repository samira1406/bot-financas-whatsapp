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

const nomesUsuarios = {
    "239972909056127": "Samira",
    "272327149391946": "Murilo"
}

const palavrasEntrada = ["salario", "extra", "freela", "bonus"]

function nomeExibicaoPorId(id) {
    return nomesUsuarios[id] || id
}

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
            console.log("\nEscaneie o QR:\n")
            qrcode.generate(qr, { small: true })
        }

        if (connection === "open") {
            console.log("Bot conectado")
        }

        if (connection === "close") {

            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

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
        const usuario = sender.split("@")[0]

        const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            ""

        const mensagem = text.toLowerCase().trim()

        const dados = await carregarDados()

        if (!dados.usuarios[usuario]) {

            dados.usuarios[usuario] = {
                entradas: [],
                gastos: []
            }

        }

        const partes = mensagem.split(" ")

        // COMANDOS
        if (mensagem === "comandos") {

            const texto = `🤖 COMANDOS DISPONÍVEIS

💰 Entradas
salario 1000
extra 200
freela 300
bonus 100

💸 Gastos
mercado 150
uber 30
pizza 60

📊 Relatórios
relatorio → mostra resumo do mês

🧹 Limpeza
reset → apaga todos dados
reset mes 3-2026 → apaga um mês específico

📋 Ajuda
comandos → lista todos comandos
`

            await sock.sendMessage(from, { text: texto })
            return
        }

        // RESET TOTAL
        if (mensagem === "reset") {

            const novo = {
                usuarios: {}
            }

            await salvarDados(novo)

            await sock.sendMessage(from, {
                text: "🧹 Todos os dados foram apagados."
            })

            return
        }

        // RESET POR MES
        if (partes[0] === "reset" && partes[1] === "mes") {

            const mesApagar = partes[2]

            if (!mesApagar) {

                await sock.sendMessage(from, {
                    text: "Use: reset mes 3-2026"
                })

                return
            }

            const dados = await carregarDados()

            for (const user in dados.usuarios) {

                dados.usuarios[user].entradas =
                    dados.usuarios[user].entradas.filter(e => e.mes !== mesApagar)

                dados.usuarios[user].gastos =
                    dados.usuarios[user].gastos.filter(g => g.mes !== mesApagar)

            }

            await salvarDados(dados)

            await sock.sendMessage(from, {
                text: `🧹 Dados do mês ${mesApagar} apagados.`
            })

            return
        }

        const nome = partes[0]
        const valor = parseFloat(partes[1])

        // RELATORIO
        if (mensagem === "relatorio") {

            const mes = obterMesAtual()

            let totalEntradas = 0
            let totalGastos = 0

            let gastosCategoria = {}

            let relatorioUsuarios = ""

            for (const user in dados.usuarios) {

                const u = dados.usuarios[user]
                const nomeMostrar = nomeExibicaoPorId(user)

                const entradasMes = u.entradas.filter(e => e.mes === mes)
                const gastosMes = u.gastos.filter(g => g.mes === mes)

                let somaEntradas = 0
                let somaGastos = 0

                entradasMes.forEach(e => somaEntradas += e.valor)

                gastosMes.forEach(g => {

                    somaGastos += g.valor

                    if (!gastosCategoria[g.nome]) {
                        gastosCategoria[g.nome] = 0
                    }

                    gastosCategoria[g.nome] += g.valor
                })

                totalEntradas += somaEntradas
                totalGastos += somaGastos

                relatorioUsuarios += `👤 ${nomeMostrar}\n`
                relatorioUsuarios += `Entradas: R$${somaEntradas}\n`
                relatorioUsuarios += `Gastos: R$${somaGastos}\n\n`
            }

            let texto = "📊 RELATÓRIO DO MÊS\n\n"

            texto += relatorioUsuarios

            texto += "💸 Gastos por categoria\n"

            for (const cat in gastosCategoria) {
                texto += `${cat}: R$${gastosCategoria[cat]}\n`
            }

            const sobra = totalEntradas - totalGastos

            texto += `\n💰 Total entradas: R$${totalEntradas}`
            texto += `\n💸 Total gastos: R$${totalGastos}`
            texto += `\n🏦 Sobrou: R$${sobra}`

            await sock.sendMessage(from, { text: texto })

            return
        }

        if (isNaN(valor)) return

        const mes = obterMesAtual()

        // ENTRADAS
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

        // GASTOS
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