/* ============================================================
   mock-data.js —— 备用示例数据
   ------------------------------------------------------------
   只在「没接上数据库」的时候出现（比如数据库临时欠费暂停、
   或者网络被墙），让页面看起来还是活的。

   这里按「天」写，网页会自动归并成周：
     - 9月28日 – 10月4日    （前一周）
     - 10月5日 – 10月11日   （上周）
     - 10月12日 – 10月18日  （本周）

   注意：所有名字都是化名（含老师），真实上线后也请保持这个原则。
   ============================================================ */

window.HOTSEARCH_MOCK = {

  days: [

    /* ---------- 本周：10月12日 – 10月18日 ---------- */

    {
      date: "2026-10-16",
      items: [
        { nickname: "小满",  content: "班主任今天破天荒没有拖堂",               category: "大事", heat: 386, likes: 28 },
        { nickname: "阿泽",  content: "食堂二楼的鸡排饭 12:10 就卖完了",         category: "日常", heat: 342, likes: 25 },
        { nickname: "十七",  content: "月考数学最后一题，全班只有 3 个人做出来",  category: "学习", heat: 298, likes: 21 }
      ]
    },
    {
      date: "2026-10-15",
      items: [
        { nickname: "毛毛",  content: "课间操改成绕操场跑两圈，全员哀嚎",         category: "日常", heat: 261, likes: 19 },
        { nickname: "柚子",  content: "黑板报拿了年级第一",                     category: "活动", heat: 233, likes: 17 },
        { nickname: "小北",  content: "体委开始偷偷组织 4×100 接棒训练",         category: "活动", heat: 205, likes: 14 },
        { nickname: "汤圆",  content: "有人把物理老师的口头禅做成了手机铃声",     category: "日常", heat: 188, likes: 13 }
      ]
    },
    {
      date: "2026-10-14",
      items: [
        { nickname: "陈子",  content: "下午第三节课突然停电三分钟，全班欢呼",     category: "大事", heat: 164, likes: 11 },
        { nickname: "点点",  content: "值日生把后墙的奖状擦得能反光",            category: "日常", heat: 121, likes: 8  },
        { nickname: "阿May", content: "有人带了整整一箱酸奶分给全班",           category: "心声", heat: 96,  likes: 6  }
      ]
    },
    {
      date: "2026-10-13",
      items: [
        { nickname: "十七",  content: "月考成绩出来，班级平均分比上次高了 4 分",  category: "学习", heat: 88,  likes: 5  },
        { nickname: "柚子",  content: "广播操比赛服装确定，全班投票选了藏蓝",     category: "活动", heat: 74,  likes: 4  }
      ]
    },

    /* ---------- 上周：10月5日 – 10月11日 ---------- */

    {
      date: "2026-10-09",
      items: [
        { nickname: "十七", content: "英语老师宣布听写改成小组对抗",             category: "学习", heat: 312, likes: 24 },
        { nickname: "毛毛", content: "后桌两个人因为一块橡皮吵了一节课",         category: "日常", heat: 276, likes: 22 },
        { nickname: "阿泽", content: "体育课测 1000 米，跑完之后没人说话",       category: "日常", heat: 244, likes: 18 },
        { nickname: "柚子", content: "有人在班级图书角放了整套漫画",            category: "心声", heat: 219, likes: 16 }
      ]
    },
    {
      date: "2026-10-08",
      items: [
        { nickname: "小北", content: "数学课代表把作业本按学号重新排了一遍",     category: "学习", heat: 176, likes: 13 },
        { nickname: "汤圆", content: "中午有人在教室弹了十分钟吉他",            category: "活动", heat: 152, likes: 10 },
        { nickname: "小满", content: "班主任的保温杯换成了超大号",              category: "日常", heat: 118, likes: 8  }
      ]
    },
    {
      date: "2026-10-06",
      items: [
        { nickname: "点点", content: "值日表重排之后，有人的名字出现了两次",     category: "日常", heat: 87,  likes: 5  },
        { nickname: "陈子", content: "班费买的新篮球第一次被投进三分",           category: "活动", heat: 63,  likes: 3  }
      ]
    },

    /* ---------- 前一周：9月28日 – 10月4日 ---------- */

    {
      date: "2026-10-02",
      items: [
        { nickname: "柚子", content: "运动会的班级口号投票选了「八班不散」",     category: "活动", heat: 341, likes: 26 },
        { nickname: "小满", content: "有人把班里养的绿萝搬到了窗台正中间",       category: "日常", heat: 205, likes: 15 },
        { nickname: "十七", content: "语文课代表开始收周记，第一次收齐",         category: "学习", heat: 168, likes: 12 }
      ]
    },
    {
      date: "2026-09-30",
      items: [
        { nickname: "阿泽", content: "班里第一盆绿萝被养死了",                  category: "日常", heat: 143, likes: 9  },
        { nickname: "毛毛", content: "有人在教室后墙贴了手写的课表",            category: "日常", heat: 96,  likes: 6  },
        { nickname: "汤圆", content: "自习课第一次做到了全程没人说话",          category: "学习", heat: 71,  likes: 4  }
      ]
    },
    {
      date: "2026-09-28",
      items: [
        { nickname: "点点", content: "换座位之后，第一排集体抗议看不见黑板",     category: "日常", heat: 84,  likes: 5  },
        { nickname: "小北", content: "水火箭比赛，有一个飞过了围墙",            category: "活动", heat: 62,  likes: 3  }
      ]
    }

  ]
};
