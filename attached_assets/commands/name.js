const { keith } = require("../Keizzah/keith");
const {getAllSudoNumbers,isSudoTableNotEmpty} = require("../bdd/sudo")
const conf = require("../set");

keith({ nomCom: "bmd", categorie: "General", reaction: "👻" }, async (dest, zk, commandeOptions) => {
    const { ms , mybotpic } = commandeOptions;
    
  const thsudo = await isSudoTableNotEmpty()

  if (thsudo) {
     let msg = `*My Super-User*\n
     *Owner Number*\n :
- 🌟 @${conf.NUMERO_OWNER}

------ *other sudos* -----\n`
     
 let sudos = await getAllSudoNumbers()

   for ( const sudo of sudos) {
    if (sudo) { // Vérification plus stricte pour éliminer les valeurs vides ou indéfinies
      sudonumero = sudo.replace(/[^0-9]/g, '');
      msg += `- 💼 @${sudonumero}\n`;
    } else {return}

   }   const ownerjid = conf.NUMERO_OWNER.replace(/[^0-9]/g) + "@s.whatsapp.net";
   const mentionedJid = sudos.concat([ownerjid])
   console.log(sudos);
   console.log(mentionedJid)
      zk.sendMessage(
        dest,
        {
          image : { url : mybotpic() },
          caption : msg,
          mentions : mentionedJid
        }
      )
  } else {
    const vcard = 'BEGIN:VCARD\n' +
              'VERSION:3.0\n' +
              'FN:' + conf.OWNER_NAME+ '\n' +
              'ORG:;\n' +
              'TEL;type=CELL;type=VOICE;waid=' + conf.NUMERO_OWNER + ':+' + conf.NUMERO_OWNER + '\n' +
              'END:VCARD'
          let buttonMessaged = {
              contacts: { displayName: conf.OWNER_NAME , contacts: [{ vcard }] },
              contextInfo: {
                  externalAdReply: {
                      title: conf.NUMERO_OWNER,
                      body: 'Touch here.',
                      renderLargerThumbnail: true,
                      thumbnailUrl: ``,
                      thumbnail:  { url : mybotpic() } ,
                      mediaType: 1,
                      mediaUrl: '',
                      sourceUrl: `https://wa.me/+` + owner + '?text=Hii+bro,I+need+BELTAH+MD+Bot', 
                  },
              },
          };
          return await zk.sendMessage(dest, buttonMessaged, {   quoted: ms, });
                  }
              });

    /*const vcard =
        'BEGIN:VCARD\n' + // metadata of the contact card
        'VERSION:3.0\n' +
        'FN:' + conf.OWNER_NAME + '\n' + // full name
        'ORG:undefined;\n' + // the organization of the contact
        'TEL;type=CELL;type=VOICE;waid=' + conf.NUMERO_OWNER + ':+' + conf.NUMERO_OWNER + '\n' + // WhatsApp ID + phone number
        'END:VCARD';
    zk.sendMessage(dest, {
        contacts: {
            displayName: conf.OWNER_NAME,
            contacts: [{ vcard }],
        },
    },{quoted:ms});
  }
});

//Suhail test codes

sᴜʜᴀɪʟ_ᴍᴅ.amd({
          pattern: "owner",
          desc: "To check ping",
          category: "general",
          react: "💜",
          filename: __filename
      },
      async(Aviator, msg) => {
          const Config = require('../config')
          const thmb = await getBuffer(global.THUMB_IMAGE)
         const vcard = 'BEGIN:VCARD\n' +
              'VERSION:3.0\n' +
              'FN:' + Config.ownername + '\n' +
              'ORG:;\n' +
              'TEL;type=CELL;type=VOICE;waid=' + global.owner + ':+' + global.owner + '\n' +
              'END:VCARD'
          let buttonMessaged = {
              contacts: { displayName: Config.ownername, contacts: [{ vcard }] },
              contextInfo: {
                  externalAdReply: {
                      title: Config.ownername,
                      body: 'Touch here.',
                      renderLargerThumbnail: true,
                      thumbnailUrl: ``,
                      thumbnail: thmb,
                      mediaType: 1,
                      mediaUrl: '',
                      sourceUrl: `https://wa.me/+` + owner + '?text=Hii+bro,I+am+' + msg.pushName,
                  },
              },
          };
          return await msg.sendMessage(msg.chat, buttonMessaged, {   quoted: msg, });
  
      }
  )*/
