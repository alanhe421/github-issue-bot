const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require("path");
const axiosInstance = axios.create();
const qs = require('querystring');
const token = process.env.TELEGRAM_TOKEN;


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

  delRepo(repo) {
    if (this.repos.includes(repo)) {
      const findIdx = this.repos.indexOf(repo)
      if (findIdx < 0) {
        return;
      }
      this.repos.splice(findIdx, 1);
      this.updateUserConfig();
    }
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
    try {
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
    } catch (e) {
      throw e;
    }
  }

  get inValid() {
    return this.id === null || this.repos.length === 0;
  }
}


const bot = new TelegramBot(token, {
  polling: true
});


class BotManager {


  constructor(bot) {
    this.bot = bot;
  }


  doHelp(msg) {
    const bot = this.bot;
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'You can search your repos by keyword. \nFirstly, /repo-add');
  }

  doAbout(msg) {
    const bot = this.bot;
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Developed By Alan He, My site is https://1991421.cn', {
      parse_mode: 'Markdown'
    });
  }

  /**
   * 添加GitHub AccessToken
   * @param msg
   * @returns {Promise<void>}
   */
  async doTokenAdd(msg) {
    const bot = this.bot;
    const chatId = msg.chat.id;
    const user = new User(String(msg.from.id));
    const tokenAdded = Boolean(user.token);
    const sended = await bot.sendMessage(chatId, tokenAdded ? 'Token Added, new token will replaced the old one.' : 'Add github token, if you need to search a private repository', {
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
  }

  doTokenClear(msg, match) {
    const bot = this.bot;

    const user = new User(String(msg.from.id));
    const chatId = msg.chat.id;
    if (user.token) {
      user.clearToken();
      bot.sendMessage(chatId, `Token cleared!`);
    } else {
      bot.sendMessage(chatId, `You haven't added the token！`);
    }

  }

  async doRepoAdd(msg, match) {
    const bot = this.bot;

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
        bot.sendMessage(sended.chat.id, `repo added\n${this.getAddedRepo()}`, {
          disable_web_page_preview: true
        });
      } else {
        bot.sendMessage(sended.chat.id, `repo name invalid, send repo path like yagop/node-telegram-bot-api`);
      }
    });

  }


  async doRepoDel(msg, match) {
    const bot = this.bot;

    const chatId = msg.chat.id;
    const user = new User(String(msg.from.id));
    const sended = await bot.sendMessage(chatId, 'Remove github repo, send repo path like `yagop/node-telegram-bot-api`', {
      reply_markup: {
        force_reply: true, parse_mode: 'Markdown'
      }
    });
    const replyToMessageListenerId = bot.onReplyToMessage(sended.chat.id, sended.message_id, (msg) => {
      bot.removeReplyListener(replyToMessageListenerId);
      bot.deleteMessage(chatId, msg.reply_to_message.message_id);
      if (repoPathIsValid(msg.text)) {
        user.delRepo(msg.text.trim());
        bot.sendMessage(sended.chat.id, `repo deleted\n${this.getAddedRepo()}`, {
          disable_web_page_preview: true
        });
      } else {
        bot.sendMessage(sended.chat.id, `repo name invalid, send repo path like yagop/node-telegram-bot-api`);
      }
    });

  }

  doRepoList(msg) {
    const bot = this.bot;

    const chatId = msg.chat.id;
    const user = new User(String(msg.from.id));
    if (user.repos.length > 0) {
      bot.sendMessage(chatId, this.getAddedRepo(user), {
        parse_mode: 'Markdown', disable_web_page_preview: true
      });
    } else {
      bot.sendMessage(chatId, `No repo added`);
    }
  }

  getAddedRepo(user) {
    return `The following repos is \n${user.repos.map(repo => `- [${repo}](https://github.com/${repo})`).join('\n')}`;
  }

  async doSearch(msg) {
    const bot = this.bot;
    if (msg.reply_to_message) {
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

    const sended = await bot.sendMessage(chatId, 'Searching⏳...');
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
      bot.editMessageText(e.message, {
        message_id: sended.message_id, chat_id: chatId
      });
    }

  }

  doRepoClear(msg, match) {
    const chatId = msg.chat.id;
    const user = new User(String(msg.from.id));
    user.clearRepo();
    bot.sendMessage(chatId, `Your repo cleared!`);
  }

  init() {
    /**
     * 除了回复的消息及指令信息外，视为关键词进行GitHub issue检索
     */
    bot.on('message', async (msg) => {
      if (msg.text.match(/\/(help|start)$/)) {
        return this.doHelp(msg);
      }
      if (msg.text.match(/\/about$/)) {
        return this.doAbout(msg);
      }
      if (msg.text.match(/\/tokenadd$/)) {
        return this.doTokenAdd(msg);
      }
      if (msg.text.match(/\/tokenclear$/)) {
        return this.doTokenClear(msg);
      }
      if (msg.text.match(/\/repoadd$/)) {
        return this.doRepoAdd(msg);
      }
      if (msg.text.match(/\/repodel$/)) {
        return this.doRepoDel(msg);
      }
      if (msg.text.match(/\/repolist$/)) {
        return this.doRepoList(msg);
      }
      if (msg.text.match(/\/repoclear$/)) {
        return this.doRepoClear(msg);
      }
      this.doSearch(msg);
    });
  }
}

new BotManager(bot).init();
