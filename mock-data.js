/* ============================================================
   mock-data.js —— 预览用的假数据
   ------------------------------------------------------------
   这个文件里的内容以后会被数据库里的真实数据替换，
   页面结构完全不用改。现在先看看效果。

   注意：所有名字都是化名（含老师），真实上线后也请保持这个原则。
   ============================================================ */

window.HOTSEARCH_MOCK = {

  days: [
    {
      date: "2026-10-15",
      label: "今天",
      settle: "20:00",
      items: [
        { nickname: "小满",  content: "班主任今天破天荒没有拖堂",              category: "大事", heat: 386, delta: 2,    likes: 28 },
        { nickname: "阿泽",  content: "食堂二楼的鸡排饭 12:10 就卖完了",        category: "日常", heat: 342, delta: null, likes: 25 },
        { nickname: "十七",  content: "月考数学最后一题，全班只有 3 个人做出来", category: "学习", heat: 298, delta: -1,   likes: 21 },
        { nickname: "毛毛",  content: "课间操改成绕操场跑两圈，全员哀嚎",        category: "日常", heat: 261, delta: 4,    likes: 19 },
        { nickname: "柚子",  content: "黑板报拿了年级第一",                    category: "活动", heat: 233, delta: null, likes: 17 },
        { nickname: "小北",  content: "体委开始偷偷组织 4×100 接棒训练",        category: "活动", heat: 205, delta: 1,    likes: 14 },
        { nickname: "汤圆",  content: "有人把物理老师的口头禅做成了手机铃声",    category: "日常", heat: 188, delta: -3,   likes: 13 },
        { nickname: "陈子",  content: "下午第三节课突然停电三分钟，全班欢呼",    category: "大事", heat: 164, delta: null, likes: 11 },
        { nickname: "点点",  content: "值日生把后墙的奖状擦得能反光",           category: "日常", heat: 121, delta: -2,   likes: 8  },
        { nickname: "阿May", content: "有人带了整整一箱酸奶分给全班",          category: "心声", heat: 96,  delta: 6,    likes: 6  }
      ]
    },
    {
      date: "2026-10-14",
      label: "昨天",
      settle: "20:00",
      items: [
        { nickname: "十七", content: "英语老师宣布下周听写改成小组对抗",        category: "学习", heat: 312, delta: 1,    likes: 24 },
        { nickname: "毛毛", content: "后桌两个人因为一块橡皮吵了一节课",        category: "日常", heat: 276, delta: null, likes: 22 },
        { nickname: "阿泽", content: "体育课测 1000 米，跑完之后没人说话",      category: "日常", heat: 244, delta: -2,   likes: 18 },
        { nickname: "柚子", content: "有人在班级图书角放了整套漫画",           category: "心声", heat: 219, delta: 3,    likes: 16 },
        { nickname: "小北", content: "数学课代表把作业本按学号重新排了一遍",    category: "学习", heat: 176, delta: null, likes: 13 },
        { nickname: "汤圆", content: "中午有人在教室弹了十分钟吉他",           category: "活动", heat: 152, delta: -4,   likes: 10 },
        { nickname: "小满", content: "班主任的保温杯换成了超大号",             category: "日常", heat: 118, delta: 2,    likes: 8  },
        { nickname: "点点", content: "值日表重排之后，有人的名字出现了两次",    category: "日常", heat: 87,  delta: -1,   likes: 5  }
      ]
    },
    {
      date: "2026-10-13",
      label: "周二",
      settle: "20:00",
      items: [
        { nickname: "十七", content: "月考成绩出来，班级平均分比上次高了 4 分", category: "学习", heat: 401, delta: null, likes: 30 },
        { nickname: "点点", content: "有人把课桌抽屉整理得像样板间",           category: "日常", heat: 268, delta: 2,    likes: 21 },
        { nickname: "柚子", content: "广播操比赛服装确定，全班投票选了藏蓝",    category: "活动", heat: 224, delta: -1,   likes: 17 },
        { nickname: "阿泽", content: "物理课做水火箭，有一个飞过了围墙",        category: "活动", heat: 197, delta: null, likes: 15 },
        { nickname: "小北", content: "有人开始用计时器刷作业，一节课两页",      category: "学习", heat: 143, delta: 3,    likes: 11 },
        { nickname: "毛毛", content: "班里第一盆绿萝被养死了",                 category: "日常", heat: 102, delta: -2,   likes: 7  }
      ]
    }
  ]
};
