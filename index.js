const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys")
const qrcode = require("qrcode-terminal")

async function startBot() {

    const { state, saveCreds } = await useMultiFileAuthState("auth")
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", (update) => {

        const { connection, qr } = update

        if (qr) {
            console.log("Escaneie o QR Code abaixo:")
            qrcode.generate(qr, { small: true })
        }

        if (connection === "open") {
            console.log("Bot conectado ao WhatsApp ✅")
        }

    })

    sock.ev.on("messages.upsert", async ({ messages }) => {

        const msg = messages[0]

        if (!msg.message) return

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text

        const from = msg.key.remoteJid

        console.log("Mensagem recebida:", text)

        if (text === "teste") {

            await sock.sendMessage(from, {
                text: "Bot funcionando 🤖"
            })

        }

    })

}

startBot()