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

function inicioDoDia(data = new Date()) {
  const d = new Date(data)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function inicioDaSemana(data = new Date()) {
  const d = new Date(data)
  const dia = d.getDay()
  const diferenca = dia === 0 ? 6 : dia - 1
  d.setDate(d.getDate() - diferenca)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function inicioDoMes(data = new Date()) {
  const d = new Date(data)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function formatarValor(valor) {
  return Number(valor).toFixed(2)
}

function somarLancamentos(lista) {
  return lista.reduce((total, item) => total + item.valor, 0)
}

function montarDetalhes(lista) {
  if (!lista.length) return "Nenhum lançamento."

  return lista
    .map((item, index) => `${index + 1}. ${item.nome} - R$ ${formatarValor(item.valor)}`)
    .join("\n")
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
          aguardandoRespostaCaixinha: false,
          valorSugeridoCaixinha: 0,
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

      const usuarioDados = dados.usuarios[usuarioId]
      const usuario = usuarioDados.nome
      const mensagemLower = mensagem.toLowerCase()
      const mes = obterMesAtual()

      if (usuarioDados.aguardandoRespostaCaixinha) {
        if (mensagemLower === "sim") {
          const valorCaixinha = usuarioDados.valorSugeridoCaixinha || 0

          if (valorCaixinha > 0) {
            usuarioDados.gastos.push({
              nome: "caixinha",
              valor: valorCaixinha,
              mes,
              data: new Date().toISOString(),
              timestamp: Date.now()
            })
          }

          usuarioDados.aguardandoRespostaCaixinha = false
          usuarioDados.valorSugeridoCaixinha = 0

          await salvarDados(dados)

          await enviarMensagemSegura(
            sock,
            from,
            `💰 ${usuario}, perfeito. Registrei R$ ${formatarValor(valorCaixinha)} como valor guardado na caixinha.`
          )
          return
        }

        if (mensagemLower === "nao" || mensagemLower === "não") {
          usuarioDados.aguardandoRespostaCaixinha = false
          usuarioDados.valorSugeridoCaixinha = 0

          await salvarDados(dados)

          await enviarMensagemSegura(
            sock,
            from,
            `👌 ${usuario}, tudo certo. Não vou guardar nada na caixinha agora.`
          )
          return
        }

        await enviarMensagemSegura(
          sock,
          from,
          `❓ ${usuario}, responde só com *sim* ou *não* para eu saber se vamos guardar o valor sugerido na caixinha.`
        )
        return
      }

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

Relatórios:
relatorio
relatorio geral

Apagar lançamentos:
apagar ultimo
apagar hoje
apagar semana
apagar mes`
        )
        return
      }

      if (mensagemLower === "relatorio") {
        const entradasMes = usuarioDados.entradas.filter((e) => e.mes === mes)
        const gastosMes = usuarioDados.gastos.filter((g) => g.mes === mes)

        const totalEntradas = somarLancamentos(entradasMes)
        const totalGastos = somarLancamentos(gastosMes)
        const saldo = totalEntradas - totalGastos

        let textoRelatorio = `📊 RELATÓRIO MENSAL - ${usuario}

💰 ENTRADAS
${montarDetalhes(entradasMes)}

Total de entradas: R$ ${formatarValor(totalEntradas)}

💸 GASTOS
${montarDetalhes(gastosMes)}

Total de gastos: R$ ${formatarValor(totalGastos)}

🧾 SALDO
Saldo do mês: R$ ${formatarValor(saldo)}`

        if (saldo > 0) {
          const valorSugerido = saldo * 0.3

          usuarioDados.aguardandoRespostaCaixinha = true
          usuarioDados.valorSugeridoCaixinha = valorSugerido

          await salvarDados(dados)

          textoRelatorio += `

🏦 SOBROU DINHEIRO
Sobraram R$ ${formatarValor(saldo)} neste mês.

Minha sugestão é guardar 30% desse valor na caixinha para render:
R$ ${formatarValor(valorSugerido)}

Quer que eu registre esse valor na caixinha?
Responda com *sim* ou *não*.`
        } else {
          usuarioDados.aguardandoRespostaCaixinha = false
          usuarioDados.valorSugeridoCaixinha = 0
          await salvarDados(dados)
        }

        await enviarMensagemSegura(sock, from, textoRelatorio)
        return
      }

      if (mensagemLower === "relatorio geral") {
        let totalEntradasGeral = 0
        let totalGastosGeral = 0
        let textoPessoas = ""
        const rankingGastos = []

        for (const id in dados.usuarios) {
          const u = dados.usuarios[id]
          const nomePessoa = u.nome || id

          const entradasMes = u.entradas.filter((e) => e.mes === mes)
          const gastosMes = u.gastos.filter((g) => g.mes === mes)

          const totalEntradasPessoa = somarLancamentos(entradasMes)
          const totalGastosPessoa = somarLancamentos(gastosMes)
          const saldoPessoa = totalEntradasPessoa - totalGastosPessoa

          totalEntradasGeral += totalEntradasPessoa
          totalGastosGeral += totalGastosPessoa

          rankingGastos.push({
            nome: nomePessoa,
            totalGastos: totalGastosPessoa
          })

          textoPessoas += `👤 ${nomePessoa}

Entradas:
${montarDetalhes(entradasMes)}

Total entradas: R$ ${formatarValor(totalEntradasPessoa)}

Gastos:
${montarDetalhes(gastosMes)}

Total gastos: R$ ${formatarValor(totalGastosPessoa)}
Saldo: R$ ${formatarValor(saldoPessoa)}

──────────────
`
        }

        const saldoGeral = totalEntradasGeral - totalGastosGeral

        const textoRelatorioGeral = `📊 RELATÓRIO GERAL DO MÊS

💰 Total geral de entradas: R$ ${formatarValor(totalEntradasGeral)}
💸 Total geral de gastos: R$ ${formatarValor(totalGastosGeral)}
🧾 Saldo geral: R$ ${formatarValor(saldoGeral)}

${textoPessoas.trim()}`

        await enviarMensagemSegura(sock, from, textoRelatorioGeral)

        rankingGastos.sort((a, b) => b.totalGastos - a.totalGastos)

        const rankingTexto = rankingGastos.length
          ? rankingGastos
              .map((item, index) => `${index + 1}. ${item.nome} — R$ ${formatarValor(item.totalGastos)}`)
              .join("\n")
          : "Nenhum gasto registrado."

        await enviarMensagemSegura(
          sock,
          from,
          `🏆 QUEM MAIS GASTOU NO MÊS

${rankingTexto}`
        )

        return
      }

      if (mensagemLower === "apagar ultimo") {
        const entradas = usuarioDados.entradas
        const gastos = usuarioDados.gastos

        const ultimaEntrada = entradas[entradas.length - 1]
        const ultimoGasto = gastos[gastos.length - 1]

        if (!ultimaEntrada && !ultimoGasto) {
          await enviarMensagemSegura(
            sock,
            from,
            "⚠️ Você não tem lançamentos para apagar."
          )
          return
        }

        let itemRemovido = null
        let tipoRemovido = ""

        if (ultimaEntrada && ultimoGasto) {
          const tsEntrada = ultimaEntrada.timestamp || 0
          const tsGasto = ultimoGasto.timestamp || 0

          if (tsEntrada >= tsGasto) {
            itemRemovido = entradas.pop()
            tipoRemovido = "entrada"
          } else {
            itemRemovido = gastos.pop()
            tipoRemovido = "gasto"
          }
        } else if (ultimaEntrada) {
          itemRemovido = entradas.pop()
          tipoRemovido = "entrada"
        } else {
          itemRemovido = gastos.pop()
          tipoRemovido = "gasto"
        }

        await salvarDados(dados)

        await enviarMensagemSegura(
          sock,
          from,
          `🗑️ ${usuario}, apaguei o último ${tipoRemovido}: ${itemRemovido.nome} R$ ${formatarValor(itemRemovido.valor)}`
        )
        return
      }

      if (
        mensagemLower === "apagar hoje" ||
        mensagemLower === "apagar semana" ||
        mensagemLower === "apagar mes"
      ) {
        let limite = 0
        let labelPeriodo = ""

        if (mensagemLower === "apagar hoje") {
          limite = inicioDoDia()
          labelPeriodo = "de hoje"
        }

        if (mensagemLower === "apagar semana") {
          limite = inicioDaSemana()
          labelPeriodo = "desta semana"
        }

        if (mensagemLower === "apagar mes") {
          limite = inicioDoMes()
          labelPeriodo = "deste mês"
        }

        const totalEntradasAntes = usuarioDados.entradas.length
        const totalGastosAntes = usuarioDados.gastos.length

        usuarioDados.entradas = usuarioDados.entradas.filter((item) => {
          const ts = item.timestamp || 0
          return ts < limite
        })

        usuarioDados.gastos = usuarioDados.gastos.filter((item) => {
          const ts = item.timestamp || 0
          return ts < limite
        })

        const entradasApagadas = totalEntradasAntes - usuarioDados.entradas.length
        const gastosApagados = totalGastosAntes - usuarioDados.gastos.length
        const totalApagados = entradasApagadas + gastosApagados

        if (totalApagados === 0) {
          await enviarMensagemSegura(
            sock,
            from,
            `⚠️ ${usuario}, não encontrei lançamentos ${labelPeriodo} para apagar.`
          )
          return
        }

        await salvarDados(dados)

        await enviarMensagemSegura(
          sock,
          from,
          `🗑️ ${usuario}, apaguei ${totalApagados} lançamento(s) ${labelPeriodo}.
Entradas apagadas: ${entradasApagadas}
Gastos apagados: ${gastosApagados}`
        )
        return
      }

      const partes = mensagemLower.split(" ")
      if (partes.length < 2) return

      const nome = partes[0]
      const valor = parseFloat(partes[1]?.replace(",", "."))

      if (isNaN(valor)) return

      if (palavrasEntrada.includes(nome)) {
        usuarioDados.entradas.push({
          nome,
          valor,
          mes,
          data: new Date().toISOString(),
          timestamp: Date.now()
        })

        await salvarDados(dados)

        await enviarMensagemSegura(
          sock,
          from,
          `💰 ${usuario}, entrada registrada: ${nome} R$ ${formatarValor(valor)}`
        )
        return
      }

      usuarioDados.gastos.push({
        nome,
        valor,
        mes,
        data: new Date().toISOString(),
        timestamp: Date.now()
      })

      await salvarDados(dados)

      await enviarMensagemSegura(
        sock,
        from,
        `💸 ${usuario}, gasto registrado: ${nome} R$ ${formatarValor(valor)}`
      )
    } catch (error) {
      console.error("Erro ao processar mensagem:", error)
    }
  })
}

iniciarBot()