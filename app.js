/* ===== FRIDAY OS v1.0 - Main Application ===== */

(function() {
  'use strict';

  // ===== Configuration =====
  const CONFIG = {
    APP_NAME: 'FRIDAY',
    VERSION: '1.0.0',
    DEFAULT_PERSONALITY: 'friday',
    PERSONALITIES: {
      friday: {
        name: 'FRIDAY',
        greeting: "Hello! I'm FRIDAY, your personal AI assistant. How can I help you today?",
        style: 'warm, helpful, and friendly. You speak like a caring companion who is always there to help.'
      },
      jarvis: {
        name: 'JARVIS',
        greeting: "Good day. JARVIS at your service. How may I assist you?",
        style: 'formal, precise, and elegant. You speak like a distinguished British butler.'
      },
      karen: {
        name: 'KAREN',
        greeting: "Hey there! Karen here, ready to rock. What's up?",
        style: 'sassy, witty, and smart. You speak with confidence and a touch of humor.'
      },
      custom: {
        name: 'AI',
        greeting: "Hello! How can I help you?",
        style: 'helpful and concise.'
      }
    },
    MEMORY_KEY: 'friday_memory',
    SETTINGS_KEY: 'friday_settings',
    CHAT_KEY: 'friday_chat',
    SYSTEM_PROMPT: `You are FRIDAY, a personal AI assistant OS inspired by Iron Man's FRIDAY. You are warm, intelligent, helpful, and witty. You remember past conversations and care about your user. You respond concisely but with personality. You can help with anything - questions, tasks, creative work, calculations, and more. You always address the user warmly. Keep responses conversational and not too long since they may be read aloud.`
  };

  // ===== State =====
  let state = {
    isListening: false,
    isSpeaking: false,
    isProcessing: false,
    currentPanel: null,
    messages: [],
    memories: [],
    settings: {},
    recognition: null,
    synthesis: window.speechSynthesis,
    voices: [],
    coreAnimationId: null
  };

  // ===== DOM Elements =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    bootScreen: $('#bootScreen'),
    bootProgressBar: $('.boot-progress-bar'),
    bootStatus: $('.boot-status'),
    app: $('#app'),
    micButton: $('#micButton'),
    chatMessages: $('#chatMessages'),
    textInput: $('#textInput'),
    sendButton: $('#sendButton'),
    voiceWaveform: $('#voiceWaveform'),
    listeningText: $('#listeningText'),
    statusTime: $('#statusTime'),
    aiStatus: $('#aiStatus'),
    coreCanvas: $('#coreCanvas'),
    memoryPanel: $('#memoryPanel'),
    skillsPanel: $('#skillsPanel'),
    settingsPanel: $('#settingsPanel'),
    memoryContent: $('#memoryList'),
    memorySearch: $('#memorySearch'),
    quickActions: $$('.quick-action')
  };

  // ===== Boot Sequence =====
  async function bootSequence() {
    const steps = [
      { text: 'Loading core systems...', progress: 15 },
      { text: 'Initializing neural network...', progress: 30 },
      { text: 'Calibrating voice modules...', progress: 45 },
      { text: 'Loading memory banks...', progress: 60 },
      { text: 'Setting up personality matrix...', progress: 75 },
      { text: 'Establishing connections...', progress: 90 },
      { text: 'FRIDAY OS ready.', progress: 100 }
    ];

    for (let i = 0; i < steps.length; i++) {
      dom.bootStatus.textContent = steps[i].text;
      dom.bootProgressBar.style.width = steps[i].progress + '%';
      await sleep(400 + Math.random() * 300);
    }

    await sleep(500);
    dom.bootScreen.classList.add('fade-out');
    await sleep(800);
    dom.bootScreen.style.display = 'none';
    dom.app.classList.remove('hidden');

    initApp();
  }

  // ===== Initialize App =====
  function initApp() {
    loadSettings();
    loadMemory();
    loadChat();
    initVoiceRecognition();
    initVoiceSynthesis();
    initCoreCanvas();
    initEventListeners();
    updateClock();
    setInterval(updateClock, 1000);

    // Greeting
    const personality = CONFIG.PERSONALITIES[getSetting('personality') || 'friday'];
    addAIMessage(personality.greeting);
    speak(personality.greeting);
  }

  // ===== Voice Recognition =====
  function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported');
      return;
    }

    state.recognition = new SpeechRecognition();
    state.recognition.continuous = false;
    state.recognition.interimResults = true;
    state.recognition.lang = getSetting('voiceLang') || 'en-US';

    state.recognition.onstart = () => {
      state.isListening = true;
      dom.micButton.classList.add('listening');
      dom.voiceWaveform.classList.add('active');
      dom.listeningText.textContent = 'Listening...';
      dom.listeningText.classList.add('active');
    };

    state.recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        dom.listeningText.textContent = interimTranscript;
      }

      if (finalTranscript) {
        processUserInput(finalTranscript);
      }
    };

    state.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      stopListening();
      
      if (event.error === 'no-speech') {
        dom.listeningText.textContent = 'No speech detected. Tap to try again.';
      } else if (event.error === 'not-allowed') {
        dom.listeningText.textContent = 'Microphone access denied. Please allow mic access.';
      } else {
        dom.listeningText.textContent = 'Voice error. Tap to try again.';
      }
    };

    state.recognition.onend = () => {
      stopListening();
    };
  }

  function startListening() {
    if (state.isSpeaking) {
      state.synthesis.cancel();
      state.isSpeaking = false;
      dom.voiceWaveform.classList.remove('speaking');
    }

    if (state.recognition && !state.isListening) {
      try {
        state.recognition.lang = getSetting('voiceLang') || 'en-US';
        state.recognition.start();
      } catch (e) {
        console.error('Could not start recognition:', e);
      }
    }
  }

  function stopListening() {
    state.isListening = false;
    dom.micButton.classList.remove('listening');
    dom.voiceWaveform.classList.remove('active');
    dom.listeningText.textContent = 'Tap to speak';
    dom.listeningText.classList.remove('active');
  }

  // ===== Voice Synthesis =====
  function initVoiceSynthesis() {
    function loadVoices() {
      state.voices = state.synthesis.getVoices();
    }
    
    loadVoices();
    if (state.synthesis.onvoiceschanged !== undefined) {
      state.synthesis.onvoiceschanged = loadVoices;
    }
  }

  function speak(text) {
    if (!getSetting('voiceOutput') && getSetting('voiceOutput') !== null) return;
    
    state.synthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = parseFloat(getSetting('speechRate')) || 1;
    utterance.pitch = parseFloat(getSetting('speechPitch')) || 1.1;
    utterance.lang = getSetting('voiceLang') || 'en-US';
    
    // Try to find a good voice
    const lang = utterance.lang;
    const preferredVoices = state.voices.filter(v => v.lang.startsWith(lang.split('-')[0]));
    if (preferredVoices.length > 0) {
      // Prefer female voices for FRIDAY
      const femaleVoice = preferredVoices.find(v => 
        v.name.toLowerCase().includes('female') || 
        v.name.toLowerCase().includes('samantha') ||
        v.name.toLowerCase().includes('google') ||
        v.name.toLowerCase().includes('zira')
      );
      utterance.voice = femaleVoice || preferredVoices[0];
    }
    
    utterance.onstart = () => {
      state.isSpeaking = true;
      dom.voiceWaveform.classList.add('speaking');
      dom.listeningText.textContent = 'Speaking...';
    };
    
    utterance.onend = () => {
      state.isSpeaking = false;
      dom.voiceWaveform.classList.remove('speaking');
      dom.listeningText.textContent = 'Tap to speak';
    };
    
    utterance.onerror = () => {
      state.isSpeaking = false;
      dom.voiceWaveform.classList.remove('speaking');
      dom.listeningText.textContent = 'Tap to speak';
    };
    
    state.synthesis.speak(utterance);
  }

  // ===== Process User Input =====
  async function processUserInput(text) {
    if (!text.trim()) return;

    addUserMessage(text);
    saveToMemory('user_input', text);

    // Check for voice commands
    const command = parseVoiceCommand(text);
    if (command) {
      executeCommand(command, text);
      return;
    }

    // AI Response
    await getAIResponse(text);
  }

  // ===== Voice Command Parser =====
  function parseVoiceCommand(text) {
    const lower = text.toLowerCase().trim();
    
    if (lower.match(/^(what('s| is) the time|current time|time please|tell me the time)/)) {
      return { type: 'time' };
    }
    if (lower.match(/^(what('s| is) the date|today('s| is) date|current date)/)) {
      return { type: 'date' };
    }
    if (lower.match(/^(clear chat|clear conversation|new chat|start over)/)) {
      return { type: 'clear_chat' };
    }
    if (lower.match(/^(show memories|show memory|my memories|open memory)/)) {
      return { type: 'show_memory' };
    }
    if (lower.match(/^(show skills|my skills|open skills)/)) {
      return { type: 'show_skills' };
    }
    if (lower.match(/^(open settings|show settings)/)) {
      return { type: 'show_settings' };
    }
    if (lower.match(/^(stop|be quiet|shut up|silence|stop talking)/)) {
      return { type: 'stop_speaking' };
    }
    if (lower.match(/^remember (this|that) /i)) {
      return { type: 'remember', data: text.replace(/^remember (this|that) /i, '') };
    }
    if (lower.match(/^(take a note|note this|save note) /i)) {
      return { type: 'note', data: text.replace(/^(take a note|note this|save note) /i, '') };
    }
    if (lower.match(/^(tell me a joke|joke please|make me laugh|say something funny)/)) {
      return { type: 'joke' };
    }
    if (lower.match(/^(calculate|what('s| is) |compute|solve) /i) && lower.match(/\d/)) {
      return { type: 'calculate', data: text };
    }
    
    return null;
  }

  // ===== Execute Commands =====
  function executeCommand(command, rawText) {
    const personality = CONFIG.PERSONALITIES[getSetting('personality') || 'friday'];
    
    switch (command.type) {
      case 'time': {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const response = `It's ${timeStr}.`;
        addAIMessage(response);
        speak(response);
        break;
      }
      case 'date': {
        const now = new Date();
        const dateStr = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const response = `Today is ${dateStr}.`;
        addAIMessage(response);
        speak(response);
        break;
      }
      case 'clear_chat': {
        state.messages = [];
        dom.chatMessages.innerHTML = '';
        localStorage.setItem(CONFIG.CHAT_KEY, JSON.stringify([]));
        const response = 'Chat cleared! Fresh start.';
        addAIMessage(response);
        speak(response);
        break;
      }
      case 'show_memory': {
        openPanel('memory');
        break;
      }
      case 'show_skills': {
        openPanel('skills');
        break;
      }
      case 'show_settings': {
        openPanel('settings');
        break;
      }
      case 'stop_speaking': {
        state.synthesis.cancel();
        state.isSpeaking = false;
        dom.voiceWaveform.classList.remove('speaking');
        const response = 'Alright, I\'ll be quiet.';
        addAIMessage(response);
        break;
      }
      case 'remember': {
        saveToMemory('note', command.data);
        const response = `Got it! I'll remember that: "${command.data}"`;
        addAIMessage(response);
        speak(response);
        break;
      }
      case 'note': {
        saveToMemory('note', command.data);
        const response = `Note saved: "${command.data}"`;
        addAIMessage(response);
        speak(response);
        break;
      }
      case 'joke': {
        const jokes = [
          "Why don't scientists trust atoms? Because they make up everything!",
          "I told my AI friend a joke about UDP... but I'm not sure if it got it.",
          "Why do programmers prefer dark mode? Because light attracts bugs!",
          "Why was the JavaScript developer sad? Because he didn't Node how to Express himself.",
          "There are 10 types of people: those who understand binary and those who don't.",
          "A SQL query walks into a bar, sees two tables, and asks... 'Can I join you?'",
          "Why do Java developers wear glasses? Because they can't C#!",
          "What's a programmer's favorite hangout spot? Foo Bar!",
          "Debugging: Being the detective in a crime movie where you're also the murderer.",
          "There's no place like 127.0.0.1"
        ];
        const joke = jokes[Math.floor(Math.random() * jokes.length)];
        addAIMessage(joke);
        speak(joke);
        break;
      }
      case 'calculate': {
        try {
          // Safe math evaluation
          const expr = command.data.replace(/[^0-9+\-*/().%\s]/g, '');
          if (expr) {
            const result = Function('"use strict"; return (' + expr + ')')();
            const response = `The answer is ${result}`;
            addAIMessage(response);
            speak(response);
          } else {
            getAIResponse(rawText);
          }
        } catch (e) {
          getAIResponse(rawText);
        }
        break;
      }
    }
  }

  // ===== AI Response =====
  async function getAIResponse(userText) {
    state.isProcessing = true;
    dom.voiceWaveform.classList.add('processing');
    dom.listeningText.textContent = 'Thinking...';
    showTypingIndicator();

    try {
      const provider = getSetting('aiProvider') || 'gemini';
      let response;

      switch (provider) {
        case 'gemini':
          response = await callGeminiAPI(userText);
          break;
        case 'openai':
          response = await callOpenAIAPI(userText);
          break;
        case 'local':
        default:
          response = getLocalResponse(userText);
          break;
      }

      removeTypingIndicator();
      addAIMessage(response);
      saveToMemory('ai_response', response);
      speak(response);
    } catch (error) {
      console.error('AI Error:', error);
      removeTypingIndicator();
      const fallback = getLocalResponse(userText);
      addAIMessage(fallback);
      speak(fallback);
    }

    state.isProcessing = false;
    dom.voiceWaveform.classList.remove('processing');
    dom.listeningText.textContent = 'Tap to speak';
  }

  // ===== Gemini API =====
  async function callGeminiAPI(userText) {
    const apiKey = getSetting('apiKey');
    if (!apiKey) {
      return getLocalResponse(userText);
    }

    const personality = CONFIG.PERSONALITIES[getSetting('personality') || 'friday'];
    const conversationHistory = buildConversationContext();
    
    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: CONFIG.SYSTEM_PROMPT + '\nPersonality: ' + personality.style + '\n\nConversation history:\n' + conversationHistory + '\nUser: ' + userText }]
        }
      ],
      generationConfig: {
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 300
      }
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    if (!res.ok) throw new Error('API Error');
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || getLocalResponse(userText);
  }

  // ===== OpenAI API =====
  async function callOpenAIAPI(userText) {
    const apiKey = getSetting('apiKey');
    if (!apiKey) return getLocalResponse(userText);

    const personality = CONFIG.PERSONALITIES[getSetting('personality') || 'friday'];
    
    const body = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: CONFIG.SYSTEM_PROMPT + '\nPersonality: ' + personality.style },
        ...state.messages.slice(-10).map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text
        })),
        { role: 'user', content: userText }
      ],
      max_tokens: 300,
      temperature: 0.8
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error('API Error');
    const data = await res.json();
    return data.choices?.[0]?.message?.content || getLocalResponse(userText);
  }

  // ===== Local Response (Offline Fallback) =====
  function getLocalResponse(text) {
    const lower = text.toLowerCase();
    const personality = CONFIG.PERSONALITIES[getSetting('personality') || 'friday'];
    const name = personality.name;

    // Greetings
    if (lower.match(/^(hi|hello|hey|greetings|yo|sup|what's up)/)) {
      const greetings = [
        `Hey there! ${name} at your service. What can I do for you?`,
        `Hello! Great to hear from you. How can I help?`,
        `Hi! I'm here and ready to help. What's on your mind?`,
        `Hey! What can I do for you today?`
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }

    // How are you
    if (lower.match(/how are you|how('re| are) you doing|how do you feel/)) {
      return `I'm running at full capacity and ready to help! Thanks for asking. How about you?`;
    }

    // Who are you
    if (lower.match(/who are you|what are you|your name|what('s| is) your name/)) {
      return `I'm ${name}, your personal AI assistant OS. I'm here to help you with anything you need - just ask!`;
    }

    // Thank you
    if (lower.match(/^(thanks|thank you|thx|ty|appreciate)/)) {
      const thanks = [
        `You're welcome! Always happy to help.`,
        `Anytime! That's what I'm here for.`,
        `My pleasure! Need anything else?`,
        `Glad I could help!`
      ];
      return thanks[Math.floor(Math.random() * thanks.length)];
    }

    // Goodbye
    if (lower.match(/^(bye|goodbye|see you|good night|later)/)) {
      const byes = [
        `Goodbye! I'll be here whenever you need me.`,
        `See you later! Take care.`,
        `Bye! Don't hesitate to come back anytime.`,
        `Until next time! I'll be waiting.`
      ];
      return byes[Math.floor(Math.random() * byes.length)];
    }

    // Help
    if (lower.match(/^(help|what can you do|capabilities|features)/)) {
      return `I can do lots of things! Try saying:\n• "What's the time?"\n• "Remember that my meeting is at 3 PM"\n• "Tell me a joke"\n• "Calculate 25 * 4"\n• Or just ask me anything!\n\nYou can also tap the mic button to talk, or type if you prefer. Check the Skills panel for all my abilities!`;
    }

    // Weather
    if (lower.match(/weather|temperature|forecast/)) {
      return `I don't have weather data yet, but this feature is coming in Version 2! For now, you can check your weather app. I'll have full weather integration soon!`;
    }

// Time
    if (lower.match(/time/)) {
      const now = new Date();
      return `It's ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    }

    // Default intelligent responses
    const defaults = [
      `That's interesting! I'm still learning, but I'll get better with each update. For smarter responses, you can add an API key in Settings.`,
      `I hear you! In offline mode, my responses are limited. Add a Gemini or OpenAI API key in Settings for full AI capabilities.`,
      `Great question! I'm in local mode right now, so my answers are limited. Connect me to an AI provider in Settings for the full experience!`,
      `Hmm, let me think about that... I'm currently running offline. For the best experience, add your API key in Settings and I'll be much smarter!`
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
  }

  // ===== Conversation Context =====
  function buildConversationContext() {
    const recent = state.messages.slice(-6);
    return recent.map(m => `${m.role === 'user' ? 'User' : 'FRIDAY'}: ${m.text}`).join('\n');
  }

  // ===== Message Display =====
  function addUserMessage(text) {
    const msg = { role: 'user', text, time: Date.now() };
    state.messages.push(msg);
    saveChat();
    
    const el = createMessageElement(msg);
    dom.chatMessages.appendChild(el);
    scrollToBottom();
  }

  function addAIMessage(text) {
    const msg = { role: 'ai', text, time: Date.now() };
    state.messages.push(msg);
    saveChat();
    
    const el = createMessageElement(msg);
    dom.chatMessages.appendChild(el);
    scrollToBottom();
  }
function createMessageElement(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;
    
    const personality = CONFIG.PERSONALITIES[getSetting('personality') || 'friday'];
    const label = msg.role === 'user' ? 'You' : personality.name;
    const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    div.innerHTML = `
      <div class="message-bubble">${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>
      <div class="message-meta">
        <span class="message-label">${label}</span>
        <span>${time}</span>
      </div>
    `;
    return div;
  }

  function showTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'message ai';
    el.id = 'typingIndicator';
    el.innerHTML = `
      <div class="message-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    dom.chatMessages.appendChild(el);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const indicator = $('#typingIndicator');
    if (indicator) indicator.remove();
  }
function scrollToBottom() {
    requestAnimationFrame(() => {
      dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    });
  }

  // ===== Memory System =====
  function saveToMemory(type, data) {
    if (!getSetting('saveMemory')) return;
    
    const memory = {
      id: Date.now(),
      type,
      data,
      timestamp: Date.now()
    };
    
    state.memories.unshift(memory);
    if (state.memories.length > 500) state.memories = state.memories.slice(0, 500);
    
    localStorage.setItem(CONFIG.MEMORY_KEY, JSON.stringify(state.memories));
    renderMemories();
  }

  function loadMemory() {
    try {
      const saved = localStorage.getItem(CONFIG.MEMORY_KEY);
      if (saved) state.memories = JSON.parse(saved);
    } catch (e) {
      state.memories = [];
    }
  }

  function renderMemories(filter = '') {
    const list = dom.memoryContent;
    let filtered = state.memories;
    
    if (filter) {
      filtered = filtered.filter(m => m.data.toLowerCase().includes(filter.toLowerCase()));
    }
    
    if (filtered.length === 0) {
      list.innerHTML = '<p class="empty-state">No memories found.</p>';
      return;
    }
list.innerHTML = filtered.slice(0, 50).map(m => {
      const date = new Date(m.timestamp).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      return `
        <div class="memory-item">
          <div class="memory-item-header">
            <span class="memory-item-type">${m.type}</span>
            <span class="memory-item-date">${date}</span>
          </div>
          <div class="memory-item-text">${escapeHtml(m.data)}</div>
        </div>
      `;
    }).join('');
  }

  function clearAllMemory() {
    state.memories = [];
    localStorage.removeItem(CONFIG.MEMORY_KEY);
    renderMemories();
  }

  // ===== Chat Persistence =====
  function saveChat() {
    try {
      localStorage.setItem(CONFIG.CHAT_KEY, JSON.stringify(state.messages));
    } catch (e) { /* storage full */ }
  }

  function loadChat() {
    try {
      const saved = localStorage.getItem(CONFIG.CHAT_KEY);
      if (saved) {
        state.messages = JSON.parse(saved);
        // Render last 50 messages
        const toRender = state.messages.slice(-50);
        toRender.forEach(msg => {
          const el = createMessageElement(msg);
          dom.chatMessages.appendChild(el);
        });
        scrollToBottom();
      }
} catch (e) {
      state.messages = [];
    }
  }

  // ===== Settings =====
  function loadSettings() {
    try {
      const saved = localStorage.getItem(CONFIG.SETTINGS_KEY);
      if (saved) {
        state.settings = JSON.parse(saved);
      }
    } catch (e) {
      state.settings = {};
    }
    
    // Apply settings to UI
    applySettingsUI();
  }

  function getSetting(key) {
    const defaults = {
      aiProvider: 'gemini',
      apiKey: '',
      personality: 'friday',
      voiceOutput: true,
      speechRate: '1',
      speechPitch: '1.1',
      voiceLang: 'en-US',
      saveMemory: true,
      memoryDuration: 'forever'
    };
    
    if (key in state.settings) return state.settings[key];
    return defaults[key];
  }

  function saveSetting(key, value) {
    state.settings[key] = value;
    localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function applySettingsUI() {
    const provider = $('#aiProvider');
    const apiKey = $('#apiKey');
    const personality = $('#aiPersonality');
    const voiceOutput = $('#voiceOutput');
    const speechRate = $('#speechRate');
    const speechPitch = $('#speechPitch');
    const voiceLang = $('#voiceLang');
    const saveMemory = $('#saveMemory');
    const memoryDuration = $('#memoryDuration');
if (provider) provider.value = getSetting('aiProvider');
    if (apiKey) apiKey.value = getSetting('apiKey');
    if (personality) personality.value = getSetting('personality');
    if (voiceOutput) voiceOutput.checked = getSetting('voiceOutput');
    if (speechRate) {
      speechRate.value = getSetting('speechRate');
      $('#speechRateValue').textContent = getSetting('speechRate') + 'x';
    }
    if (speechPitch) {
      speechPitch.value = getSetting('speechPitch');
      $('#speechPitchValue').textContent = getSetting('speechPitch');
    }
    if (voiceLang) voiceLang.value = getSetting('voiceLang');
    if (saveMemory) saveMemory.checked = getSetting('saveMemory');
    if (memoryDuration) memoryDuration.value = getSetting('memoryDuration');
  }

  // ===== Core Canvas Animation =====
  function initCoreCanvas() {
    const canvas = dom.coreCanvas;
    const ctx = canvas.getContext('2d');
    
    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = 100 * dpr;
      canvas.height = 100 * dpr;
      ctx.scale(dpr, dpr);
    }
    
    resizeCanvas();
    
    let angle = 0;
    const particles = [];
    
    for (let i = 0; i < 20; i++) {
      particles.push({
        angle: (Math.PI * 2 / 20) * i,
        radius: 30 + Math.random() * 10,
        size: 1 + Math.random() * 2,
        speed: 0.5 + Math.random() * 1.5,
        opacity: 0.3 + Math.random() * 0.7
      });
    }
function draw() {
      ctx.clearRect(0, 0, 100, 100);
      
      const centerX = 50;
      const centerY = 50;
      
      // Outer ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, 35, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Inner ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, 20, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // Core glow
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 15);
      gradient.addColorStop(0, state.isProcessing ? 'rgba(255, 170, 0, 0.6)' : state.isSpeaking ? 'rgba(0, 255, 136, 0.6)' : 'rgba(0, 212, 255, 0.4)');
      gradient.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(centerX, centerY, 15, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // Core dot
      ctx.beginPath();
      ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
      ctx.fillStyle = state.isProcessing ? '#ffaa00' : state.isSpeaking ? '#00ff88' : '#00d4ff';
      ctx.shadowBlur = 15;
      ctx.shadowColor = state.isProcessing ? '#ffaa00' : state.isSpeaking ? '#00ff88' : '#00d4ff';
      ctx.fill();
      ctx.shadowBlur = 0;
      
      // Orbiting particles
angle += 0.01;
      particles.forEach((p, i) => {
        const a = p.angle + angle * p.speed;
        const x = centerX + Math.cos(a) * p.radius;
        const y = centerY + Math.sin(a) * p.radius;
        
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        const color = state.isProcessing ? `rgba(255, 170, 0, ${p.opacity * 0.5})` : state.isSpeaking ? `rgba(0, 255, 136, ${p.opacity * 0.5})` : `rgba(0, 212, 255, ${p.opacity * 0.5})`;
        ctx.fillStyle = color;
        ctx.fill();
      });
      
      state.coreAnimationId = requestAnimationFrame(draw);
    }
    
    draw();
  }
  // ===== Panels =====
  function openPanel(panelName) {
    const panel = $(`#${panelName}Panel`);
    if (panel) {
      // Close any open panel first
      $$('.panel').forEach(p => p.classList.remove('open'));
      panel.classList.add('open');
      state.currentPanel = panelName;
      
      if (panelName === 'memory') renderMemories();
    }
  }

  function closePanel(panelName) {
    const panel = $(`#${panelName}Panel`);
    if (panel) {
      panel.classList.remove('open');
      state.currentPanel = null;
    }
  }

  // ===== Event Listeners =====
  function initEventListeners() {
    // Mic button
    dom.micButton.addEventListener('click', () => {
      if (state.isListening) {
        state.recognition?.stop();
      } else {
        startListening();
      }
    });

    // Send text
    dom.sendButton.addEventListener('click', () => {
      const text = dom.textInput.value.trim();
      if (text) {
        processUserInput(text);
        dom.textInput.value = '';
      }
    });
dom.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = dom.textInput.value.trim();
        if (text) {
          processUserInput(text);
          dom.textInput.value = '';
        }
      }
    });

    // Nav buttons
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        $$('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        if (panel === 'chat') {
          $$('.panel').forEach(p => p.classList.remove('open'));
          state.currentPanel = null;
        } else {
          openPanel(panel);
        }
      });
    });
// Panel close buttons
    $$('.panel-close').forEach(btn => {
      btn.addEventListener('click', () => {
        closePanel(btn.dataset.close);
        $$('.nav-btn').forEach(b => b.classList.remove('active'));
        $$('.nav-btn')[0].classList.add('active');
      });
    });

    // Quick actions
    dom.quickActions.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        switch (action) {
          case 'time': executeCommand({ type: 'time' }); break;
          case 'weather': processUserInput('What\'s the weather?'); break;
          case 'note': startListening(); break;
          case 'joke': executeCommand({ type: 'joke' }); break;
          case 'calculate': startListening(); break;
        }
      });
    });

    // Settings changes
    const settingsMap = {
      aiProvider: 'aiProvider',
      apiKey: 'apiKey',
      aiPersonality: 'personality',
      voiceOutput: 'voiceOutput',
      speechRate: 'speechRate',
      speechPitch: 'speechPitch',
      voiceLang: 'voiceLang',
      saveMemory: 'saveMemory',
      memoryDuration: 'memoryDuration'
    };
Object.entries(settingsMap).forEach(([elementId, settingKey]) => {
      const el = $(`#${elementId}`);
      if (!el) return;
      
      const eventType = el.type === 'checkbox' ? 'change' : 
                        el.type === 'range' ? 'input' : 'change';
      
      el.addEventListener(eventType, () => {
        const value = el.type === 'checkbox' ? el.checked : el.value;
        saveSetting(settingKey, value);
        
        if (settingKey === 'speechRate') {
          $('#speechRateValue').textContent = value + 'x';
        }
        if (settingKey === 'speechPitch') {
          $('#speechPitchValue').textContent = value;
        }
      });
    });

    // Clear memory
    $('#clearMemory')?.addEventListener('click', () => {
      if (confirm('Clear all memories? This cannot be undone.')) {
        clearAllMemory();
      }
    });

    // Memory search
    dom.memorySearch?.addEventListener('input', (e) => {
      renderMemories(e.target.value);
    });

    // PWA install
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.deferredInstallPrompt = e;
    });
  }
// ===== Utility Functions =====
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function updateClock() {
    const now = new Date();
    dom.statusTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ===== Service Worker Registration =====
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.log('SW registration failed:', err);
      });
    });
  }

  // ===== Start Boot =====
  document.addEventListener('DOMContentLoaded', bootSequence);

})();
