const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require("path");
const axiosInstance = axios.create();
const qs = require('querystring');
const token = process.env.TELEGRAM_TOKEN;

/**
 * 用户
 */
class User {
  /**
   *  用户唯一ID
   */
  id = null;
  /**
   * GitHub access token
   * @see https://github.com/settings/tokens/new
   */
  token = null;
  repos = [];

  constructor(id) {
    this.id = id;
    let userConfig = this.getUserConfig();
    this.repos = userConfig.repos || [];
    this.token = userConfig.token;
  }

  addToken(token) {
    this.token = token;
    this.updateUserConfig();
  }

  getUserConfig() {
    try {
      const configStr = fs.readFileSync(path.join(__dirname, '_config.json'), {encoding: 'utf8'});
      let parse = JSON.parse(configStr);
      if (!parse[this.id]) {
        parse[this.id] = {};
      }
      return parse[this.id];
    } catch {
      return ({});
    }
  }

  clearToken() {
    this.token = null;
    this.updateUserConfig();
  }

  addRepo(repo) {
    if (this.repos.includes(repo)) {
      return;
    }
    this.repos.push(repo);
    this.updateUserConfig();
  }

  updateEntireConfig(configJson) {
    fs.writeFile(path.join(__dirname, '_config.json'), JSON.stringify(configJson, null, 4), 'utf8', () => null);
  }

  updateUserConfig() {
    const entireConfig = this.getEntireConfig();
    if (!entireConfig[this.id]) {
      entireConfig[this.id] = {};
    }
    entireConfig[this.id] = {
      repos: this.repos, token: this.token,
    }
    this.updateEntireConfig(entireConfig);
  }

  getEntireConfig() {
    const entireConfig = fs.readFileSync(path.join(__dirname, '_config.json'), {encoding: 'utf8'});
    try {
      return JSON.parse(entireConfig);
    } catch {
      return {}
    }
  }

  clearRepo() {
    this.repos = [];
    this.updateUserConfig();
  }

  /**
   * 获取用户的所有仓库的命中issue
   */
  async searchIssues(keyword) {
    const resArr = await Promise.all(this.repos.map(repo => {
      return axiosInstance.get(`https://api.github.com/search/issues?q=repo:${repo}%20type:issue%20${qs.escape(keyword)}`, {
        headers: this.token ? {
          Authorization: `token ${this.token}`
        } : undefined
      }).then(res => res.data)
    }));
    return resArr.reduce((totalItems, res) => {
      return totalItems.concat(res.items);
    }, []);
  }

  get reposStr() {
    return this.repos.join(',');
  }

  get inValid() {
    return this.id === null || this.repos.length === 0;
  }
}


const bot = new TelegramBot(token, {
  polling: true
});


bot.onText(/\/(help|start)$/, (msg, match) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'You can search your repos by keyword. \nFirstly, /repo-add');
});


bot.onText(/\/about$/, (msg, match) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Developed By Alan He, My site is https://1991421.cn', {
    parse_mode: 'Markdown'
  });
});

/**
 * 添加GitHub AccessToken
 */
bot.onText(/\/tokenadd$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = new User(String(msg.from.id));
  const tokenAdded = Boolean(user.token);
  const sended = await bot.sendMessage(chatId, tokenAdded
    ? 'Token Added, new token will replaced the old one.'
    : 'Add github token, if you need to search a private repository', {
    reply_markup: {
      force_reply: false, parse_mode: 'Markdown'
    }
  });
  const replyToMessageListenerId = bot.onReplyToMessage(sended.chat.id, sended.message_id, (msg) => {
    if (msg.text.trim()) {
      bot.removeReplyListener(replyToMessageListenerId);
      bot.deleteMessage(chatId, msg.reply_to_message.message_id);
      user.addToken(msg.text.trim());
      bot.sendMessage(sended.chat.id, `token added!`);
    } else {
      bot.sendMessage(sended.chat.id, `token is invalid!`);
    }
  });
});

bot.onText(/\/tokenclear$/, async (msg, match) => {
  const user = new User(String(msg.from.id));
  const chatId = msg.chat.id;
  if (user.token) {
    user.clearToken();
    bot.sendMessage(chatId, `Token cleared!`);
  } else {
    bot.sendMessage(chatId, `You haven't added the token！`);
  }
});

/**
 * 添加GitHub仓库
 */
bot.onText(/\/repoadd$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = new User(String(msg.from.id));

  const sended = await bot.sendMessage(chatId, 'Add github repo, send repo path like `yagop/node-telegram-bot-api`', {
    reply_markup: {
      force_reply: true, parse_mode: 'Markdown'
    }
  });
  const replyToMessageListenerId = bot.onReplyToMessage(sended.chat.id, sended.message_id, (msg) => {
    bot.removeReplyListener(replyToMessageListenerId);
    bot.deleteMessage(chatId, msg.reply_to_message.message_id);
    if (repoPathIsValid(msg.text)) {
      user.addRepo(msg.text.trim());
      bot.sendMessage(sended.chat.id, `repo added\nThe following repos is ${user.reposStr}`);
    } else {
      bot.sendMessage(sended.chat.id, `repo name invalid, send repo path like yagop/node-telegram-bot-api`);
    }
  });
});

bot.onText(/\/repolist$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = new User(String(msg.from.id));
  if (user.reposStr) {
    bot.sendMessage(chatId, `The following repos is ${user.reposStr}`);
  } else {
    bot.sendMessage(chatId, `No repo added`);
  }
});

bot.onText(/\/repoclear$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = new User(String(msg.from.id));
  user.clearRepo();
  bot.sendMessage(chatId, `Your repo cleared!`);
});

/**
 * 除了回复的消息及指令信息外，视为关键词进行GitHub issue检索
 */
bot.on('message', async (msg) => {
  if (msg.text.startsWith('/') || msg.reply_to_message) {
    return;
  }
  const user = new User(String(msg.from.id));
  const chatId = msg.chat.id;
  if (user.inValid) {
    return bot.sendMessage(chatId, 'You should add repo firstly! just type /repoadd');
  }
  if (msg.text.trim().length < 2) {
    return bot.sendMessage(chatId, 'Keywords must have at least 2 characters!');
  }

  const sended = await bot.sendMessage(chatId, 'Searching⏳...,');
  try {
    const issues = await user.searchIssues(msg.text);
    if (issues.length) {
      const issuesGroups = groupBy(issues);
      bot.editMessageText(`Found ${issues.length} issues about keyword \`${msg.text}\`\n` + buildIssueContent(issuesGroups[0]), {
        message_id: sended.message_id, chat_id: chatId, parse_mode: 'Markdown'
      });
      if (issuesGroups.length > 1) {
        issuesGroups.slice(1).forEach(issues => {
          bot.sendMessage(chatId, buildIssueContent(issues), {
            disable_web_page_preview: true
          });
        })
      }
    } else {
      bot.editMessageText(`No issues matched your keyword \`${msg.text}\`.`, {
        message_id: sended.message_id, chat_id: chatId, parse_mode: 'Markdown'
      });
    }
  } catch (e) {
    bot.editMessageText(e.response.data.errors.map(item => item.message).join(), {
      message_id: sended.message_id, chat_id: chatId
    });
  }
});


function repoPathIsValid(repoPath) {
  repoPath = repoPath.trim();
  if (repoPath) {
    return repoPath.match(/^[^/]+\/[^/]+$/)
  }
  return false;
}

function groupBy(arr, chunkSize = 5) {
  return arr.reduce((res, item, index) => {
    let groupNo = Math.floor(index / chunkSize);
    if (!res[groupNo]) {
      res[groupNo] = [];
    }
    res[groupNo].push(item);
    return res;
  }, []);
}


function buildIssueContent(issues = []) {
  return issues.map((item, index) => `${index + 1}. ${item.title}：${item.html_url}`).join('\n')
}
