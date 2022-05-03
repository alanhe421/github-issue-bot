const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_TOKEN;
const axios = require('axios');
const fs = require('fs');
const path = require("path");
const axiosInstance = axios.create();

/**
 * 用户
 */
class User {
  /**
   *  用户唯一ID
   */
  _id = null;
  _repos = [];

  constructor(id) {
    this._id = id;
    let configJson = fs.readFileSync(path.join(__dirname, '_config.json'), {encoding: 'utf8'});
    this._repos = JSON.parse(configJson)[this._id] || [];
  }

  addRepo(repo) {
    this._repos.push(repo);
    let configStr = fs.readFileSync(path.join(__dirname, '_config.json'), {encoding: 'utf8'});
    const configJson = JSON.parse(configStr);
    configJson[this.id] = this._repos;
    fs.writeFile(path.join(__dirname, '_config.json'), JSON.stringify(configJson), 'utf8', () => null);
  }

  async searchIssues(keyword) {
    const resArr = await Promise.all(this._repos.map(repo => {
      return axiosInstance.get(`https://api.github.com/search/issues?q=repo:${repo}%20type:issue%20${keyword}`).then(res => res.data)
    }));
    return resArr.reduce((totalItems, res) => {
      return totalItems.concat(res.items);
    }, []);
  }

  get reposStr() {
    return this._repos.join(',');
  }

  get inValid() {
    return this._id === null || this._repos.length === 0;
  }
}


const bot = new TelegramBot(token, {
  polling: true
});


bot.onText(/\/help$/, (msg, match) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'you can search your repos by keyword. \nFirstly, /repo-add');
});


bot.onText(/\/about$/, (msg, match) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Developed By Alan He, My site is https://1991421.cn');
});

/**
 * 添加GitHub仓库
 */
bot.onText(/\/repo-add$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = new User(String(msg.from.id));

  const sended = await bot.sendMessage(chatId, 'add github repo, send repo path like yagop/node-telegram-bot-api', {
    reply_markup: {
      force_reply: true,
    }
  });
  bot.onReplyToMessage(sended.chat.id, sended.message_id, (msg) => {
    if (repoPathIsValid(msg.text)) {
      user.addRepo(msg.text.trim());
      bot.sendMessage(sended.chat.id, `repo added\nThe following repos is ${user.reposStr}`);
    } else {
      bot.sendMessage(sended.chat.id, `repo name invalid, send repo path like yagop/node-telegram-bot-api`);
    }
  })
});

bot.onText(/\/repo-list$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = new User(String(msg.from.id));
  bot.sendMessage(chatId, `The following repos is ${user.reposStr}`);
});

bot.on('message', async (msg) => {
  const user = new User(String(msg.from.id));
  const chatId = msg.chat.id;
  if (user.inValid) {
    return bot.sendMessage(chatId, 'You should add repo firstly!.');
  }
  if (msg.text.trim().length < 2) {
    return bot.sendMessage(chatId, 'Keywords must have at least 2 characters!');
  }

  const sended = await bot.sendMessage(chatId, 'searching⏳...,');

  const issues = await user.searchIssues(msg.text);
  if (issues.length) {
    bot.editMessageText(issues.map((item, index) => `${index + 1}.${item.title}：${item.html_url}`).join('\n\n'), {
      message_id: sended.message_id, chat_id: chatId
    });
  } else {
    bot.editMessageText('No results matched your search.', {message_id: sended.message_id, chat_id: chatId});
  }
});


function repoPathIsValid(repoPath) {
  repoPath = repoPath.trim();
  if (repoPath) {
    return repoPath.match(/^[^/]+\/[^/]+$/)
  }
  return false;
}


