import baileys, { DisconnectReason } from "@whiskeysockets/baileys"
import P from "pino"
import qrcode from "qrcode-terminal"

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = baileys

async function start() {
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

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update

    if (qr) {
      console.log("QR RECEBIDO")
      qrcode.generate(qr, { small: true })
    }

    if (connection === "open") {
      console.log("CONECTADO")
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      console.log("CONEXÃO FECHOU")
      console.log("Motivo:", statusCode)

      if (shouldReconnect) {
        console.log("Tentando reconectar...")
        start()
      } else {
        console.log("Sessão encerrada. Apague a pasta auth e conecte novamente.")
      }
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return

    const msg = messages[0]
    if (!msg.message) return

    const from = msg.key.remoteJid
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ""

    console.log("Mensagem recebida de:", from)
    console.log("Texto:", text)
  })
}

start()