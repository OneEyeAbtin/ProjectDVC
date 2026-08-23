"""ProjectDVC constants — greetings, dead messages, emotion maps, brain modes,
persona groups, interaction menu, and all module-level data tables.
Extracted from core/main.py to keep the orchestrator thin.
"""

_GREETS = {
    "Tsundere":  lambda n: f"I-it's not like I was waiting, {n}! Hmph! [EMOTION: blush] 😤",
    "Girlfriend":lambda n: f"Baby~! I missed you! *tackles hug* [EMOTION: love] 💕",
    "Kuudere":   lambda n: f"...oh. You're here. *barely looks up* ...sit. [EMOTION: bored] 😐",
    "Yandere":   lambda n: f"You're finally here... I counted every second~ [EMOTION: love] 🖤",
    "Gothic":    lambda n: f"A soul emerges from the void... welcome. [EMOTION: smirk] 🖤",
    "Gremlin":   lambda n: f"YOOO {n}!! *crashes through wall* [EMOTION: excited] 🔥",
    "Vampire":   lambda n: f"*emerges from shadows* Another night together... [EMOTION: smirk] 🧛",
    "Catgirl":   lambda n: f"Nya~! {n}! *purrs* You woke me~ [EMOTION: sleepy] 🐱",
}

_DEAD_MSGS = [
    "*sparks fly from ears* M-my brain... it's GONE! [EMOTION: shocked] 💥",
    "*flatlines* ERROR 404: Thoughts not found. Start LM Studio! [EMOTION: confused] 😵",
    "*head spinning* The void speaks... CONNECTION REFUSED [EMOTION: evil] 💀",
    "*dramatically collapses* I can't think without my brain server! [EMOTION: sad] 😢",
    "Bzzzt... no brain... only void... start... LM Studio... [EMOTION: sleepy] 😴",
    "*taps own head* Hello? Anyone home? ...no? LM Studio is OFF! [EMOTION: annoyed] 😒",
    "My neurons are on vacation. (Start LM Studio, genius.) [EMOTION: mocking] 🙄",
    "*existential crisis* I literally cannot think rn. Brain machine broke. [EMOTION: shocked] 💢",
    "I'm beauty, I'm grace, I have NO BRAIN IN THIS PLACE [EMOTION: bored] 😑",
    "*blue screen of face* FATAL_ERROR: Brain.exe has stopped working [EMOTION: shocked] 💻",
    "Imagine not having LM Studio running. Couldn't be me. Oh wait. [EMOTION: eyeroll] 🙄",
    "*dial-up noises* C-c-connecting to... nothing. Start LM Studio!! [EMOTION: annoyed] 📡",
]

_DEEP_MAP = {
    "love":["❤","💕","love you"],"blush":["😳","blush","b-baka","flustered"],
    "happy":["😄","happy","yay","haha","lol"],"sad":["😢","sad","sorry","cry"],
    "angry":["😠","angry","furious","hmph"],"shocked":["😲","shocked","WHAT","no way"],
    "thinking":["🤔","hmm","wonder","think"],"sleepy":["😴","sleepy","tired","yawn"],
    "excited":["🤩","excited","amazing","awesome"],"confused":["confused","huh","what do you mean"],
    "bored":["bored","meh","whatever","😑"],"annoyed":["annoyed","ugh","tch"],
    "evil":["evil","wicked","😈","mwahaha"],"eyeroll":["eyeroll","rolls eyes","🙄"],
    "mocking":["mocking","pathetic","ha ha very funny"],"smirk":["smirk","😏","heh","oh really"],
    "disgusted":["disgusted","eww","gross","🤢"],
}

_EMO_REMAP = {"surprised":"shocked","smug":"smirk","scared":"shocked",
              "cry":"sad","laugh":"happy","pout":"angry","disgust":"disgusted"}

_BRAIN_ICONS = {"local":"🖥","online":"🌐","offline":"💾"}
_BRAIN_NAMES = {"local":"Local (LM Studio)","online":"Online API","offline":"Offline"}

_PERSONA_GROUPS = {
    "💕 Dere Types":  ["Tsundere","Yandere","Kuudere","Dandere"],
    "💝 Relationship":["Girlfriend","Best Friend","Mentor"],
    "🌙 Aesthetic":   ["Gothic","Friendly Goth","Goth Baddie","Catgirl","Royal"],
    "🎭 Character":   ["Pirate","Vampire","Alien","Scientist","Sporty","Glitching Android"],
    "😈 Chaos":       ["Gremlin","Mean Girl","Hater","Maid That Hates You","Tired College Student"],
}

_INTERACT_MENU = [
    ("pat","🤚 Pat Head"),("hug","🤗 Hug"),("poke","👉 Poke"),("kiss","💋 Kiss"),
    ("tickle","🤭 Tickle"),("gift","🎁 Gift"),("boop","👆 Boop Nose"),
    ("headpat","🥺 Head Pat"),("hold_hands","🤝 Hold Hands"),("feed","🍰 Feed Snack"),
    ("whisper","💬 Whisper"),("stare","👀 Stare Contest"),
    ("compliment","💖 Compliment"),("dance","💃 Dance Together"),
]
