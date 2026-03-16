import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys"

import P from "pino"
import qrcode from "qrcode-terminal"
import fs from "fs-extra"

const caminhoDB = "./database/dados.json"
const GRUPO_PERMITIDO = "120363408102479565@g.us"
const palavrasEntrada = ["salario", "extra", "freela", "bonus"]

async function carregarDados() {
  if (!(await fs.pathExists(caminhoDB))) {
    const inicial = { usuarios: {} }
    await fs.outputJson(caminhoDB, inicial, { spaces: 2 })
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

async function enviarMensagemSegura(sock, jid, text) {
  try {
    await sock.sendMessage(jid, { text })
    return true
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error)
    return false
  }
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
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        console.log("🔄 Conexão fechada. Reinicie o processo manualmente.")
      } else {
        console.log("❌ Sessão encerrada")
      }
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type !== "notify") return

      const msg = messages?.[0]
      if (!msg?.message) return
      if (msg.key.fromMe) return

      const from = msg.key.remoteJid
      if (from !== GRUPO_PERMITIDO) return

      const sender = msg.key.participant || from
      const usuarioId = sender.split("@")[0]
      const messageId = msg.key.id

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ""

      const mensagem = text.trim()
      if (!mensagem) return

      console.log("Mensagem recebida:", {
        from,
        sender,
        messageId,
        mensagem
      })

      const dados = await carregarDados()

      if (!dados.usuarios[usuarioId]) {
        dados.usuarios[usuarioId] = {
          nome: null,
          aguardandoNome: true,
          ultimoMessageIdProcessado: messageId,
          entradas: [],
          gastos: []
        }

        await salvarDados(dados)

        await enviarMensagemSegura(
          sock,
          from,
          "👋 Oi! Antes de começar, como você quer ser chamada?"
        )
        return
      }

      if (dados.usuarios[usuarioId].ultimoMessageIdProcessado === messageId) {
        return
      }

      dados.usuarios[usuarioId].ultimoMessageIdProcessado = messageId
      await salvarDados(dados)

      if (dados.usuarios[usuarioId].aguardandoNome) {
        dados.usuarios[usuarioId].nome = mensagem
        dados.usuarios[usuarioId].aguardandoNome = false

        await salvarDados(dados)

        await enviarMensagemSegura(
          sock,
          from,
          `✅ Perfeito! Vou te chamar de *${mensagem}*.\n\nDigite *comandos* para ver o que eu consigo fazer.`
        )
        return
      }

      const usuario = dados.usuarios[usuarioId].nome
      const mensagemLower = mensagem.toLowerCase()

      if (mensagemLower === "comandos") {
        await enviarMensagemSegura(
          sock,
          from,
          `📋 COMANDOS

Registrar gasto:
ex: uber 30
ex: mercado 120,50

Registrar entrada:
ex: salario 5000
ex: freela 800

Ver relatório:
relatorio`
        )
        return
      }

      if (mensagemLower === "relatorio") {
        const mes = obterMesAtual()
        let totalEntradas = 0
        let totalGastos = 0

        for (const id in dados.usuarios) {
          const u = dados.usuarios[id]
          const entradasMes = u.entradas.filter(e => e.mes === mes)
          const gastosMes = u.gastos.filter(g => g.mes === mes)

          entradasMes.forEach(e => {
            totalEntradas += e.valor
          })

          gastosMes.forEach(g => {
            totalGastos += g.valor
          })
        }

        const saldo = totalEntradas - totalGastos

        await enviarMensagemSegura(
          sock,
          from,
          `📊 RELATÓRIO

Entradas: R$ ${totalEntradas.toFixed(2)}
Gastos: R$ ${totalGastos.toFixed(2)}
Saldo: R$ ${saldo.toFixed(2)}`
        )
        return
      }

      const partes = mensagemLower.split(" ")
      if (partes.length < 2) return

      const nome = partes[0]
      const valor = parseFloat(partes[1]?.replace(",", "."))

      if (isNaN(valor)) return

      const mes = obterMesAtual()

      if (palavrasEntrada.includes(nome)) {
        dados.usuarios[usuarioId].entradas.push({
          nome,
          valor,
          mes
        })

        await salvarDados(dados)

        await enviarMensagemSegura(
          sock,
          from,
          `💰 ${usuario}, entrada registrada: ${nome} R$ ${valor.toFixed(2)}`
        )
        return
      }

      dados.usuarios[usuarioId].gastos.push({
        nome,
        valor,
        mes
      })

      await salvarDados(dados)

      await enviarMensagemSegura(
        sock,
        from,
        `💸 ${usuario}, gasto registrado: ${nome} R$ ${valor.toFixed(2)}`
      )
    } catch (error) {
      console.error("Erro ao processar mensagem:", error)
    }
  })
}

iniciarBot()