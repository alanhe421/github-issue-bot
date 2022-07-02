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
  _id = null;
  _repos = [];

  constructor(id) {
    this._id = id;
    try {
      let configJson = fs.readFileSync(path.join(__dirname, '_config.json'), {encoding: 'utf8'});
      this._repos = JSON.parse(configJson)[this._id] || [];
    } catch (e) {
      console.error(e);
      this._repos = [];
      fs.writeFile(path.join(__dirname, '_config.json'), JSON.stringify({}), 'utf8', () => null);
    }
  }

  addRepo(repo) {
    if (this._repos.includes(repo)) {
      return;
    }
    this._repos.push(repo);
    let configStr = fs.readFileSync(path.join(__dirname, '_config.json'), {encoding: 'utf8'});
    const configJson = JSON.parse(configStr);
    configJson[this._id] = this._repos;
    fs.writeFile(path.join(__dirname, '_config.json'), JSON.stringify(configJson), 'utf8', () => null);
  }

  clearRepo() {
    let configStr = fs.readFileSync(path.join(__dirname, '_config.json'), {encoding: 'utf8'});
    const configJson = JSON.parse(configStr);
    delete configJson[this._id];
    fs.writeFile(path.join(__dirname, '_config.json'), JSON.stringify(configJson), 'utf8', () => null);
  }

  async searchIssues(keyword) {
    const resArr = await Promise.all(this._repos.map(repo => {
      return axiosInstance.get(`https://api.github.com/search/issues?q=repo:${repo}%20type:issue%20${qs.escape(keyword)}`).then(res => res.data)
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
  const replyToMessageListener = bot.onReplyToMessage(sended.chat.id, sended.message_id, (msg) => {
    bot.removeReplyListener(replyToMessageListener);
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

bot.on('message', async (msg) => {
  if (msg.text.match(/\/(help|start)$/) || msg.text.match(/\/about$/) || msg.text.match(/\/repoadd$/) || msg.text.match(/\/repolist$/) || msg.text.match(/\/repoclear$/)) {
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

  const sended = await bot.sendMessage(chatId, 'searching⏳...,');

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
