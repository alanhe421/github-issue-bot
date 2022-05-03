const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_TOKEN;
const axios = require('axios');
const axiosInstance = axios.create();

/**
 * 用户
 */
class User {
  _repos = ['alanhg/others-note', 'alanhg/coding-note'];

  constructor() {
  }

  addRepo(repo) {
    this._repos.push(repo)
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
    return this._repos.length === 0;
  }
}

const user = new User();

const bot = new TelegramBot(token, {
  polling: true
});


bot.onText(/\/help$/, (msg, match) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'you can search your repos by keyword. \nFirstly, add some repos');
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
  const sended = await bot.sendMessage(chatId, 'add github repo, send repo path like yagop/node-telegram-bot-api', {
    reply_markup: {
      force_reply: true,
    }
  });
  bot.onReplyToMessage(sended.chat.id, sended.message_id, (msg) => {
    user.addRepo(msg.text);
    bot.sendMessage(sended.chat.id, `repo added\nThe following repos is ${user.reposStr}`);
  })
});

bot.onText(/\/repo-list$/, async (msg, match) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `The following repos is ${user.reposStr}`);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (user.inValid) {
    return bot.sendMessage(chatId, 'You should add repo firstly!.');
  }
  if (msg.text.trim().length < 2) {
    return bot.sendMessage(chatId, 'Keywords must have at least 2 characters!');
  }
  const issues = await user.searchIssues(msg.text);
  if (issues.length) {
    bot.sendMessage(chatId, issues.map(item => item.title + item.html_url).join('\n'));
  } else {
    bot.sendMessage(chatId, 'No results matched your search.');
  }
});
