// Migrated from VirtourV2/server/data.js. These are examples, not live park data.
export const attractions = [
  { id: 'west-lake', name: '西湖', city: '杭州', category: '自然风光', tags: ['湖光山色', '免费', '散步', '亲子'], price: 0, hours: '全天开放（外围公共区域）', duration: 3, rating: 4.9, description: '杭州湖泊景区，适合步行游览。', address: '杭州市西湖区龙井路1号', tip: '游船、部分园中园另收费。', story: '西湖以“一山、二塔、三岛、三堤、五湖”的格局闻名。苏堤与北宋苏轼疏浚西湖的故事相连。' },
  { id: 'lingyin', name: '灵隐寺', city: '杭州', category: '人文古迹', tags: ['古寺', '山林', '文化'], price: 75, hours: '07:00–18:00（示例）', duration: 2.5, rating: 4.8, description: '杭州历史古寺，邻近飞来峰。', address: '杭州市西湖区法云弄1号', tip: '示例费用含飞来峰45元、寺院香花券30元；以官方公告为准。', story: '灵隐寺始建于东晋，相传僧人慧理见此处山峰奇秀，认为是“仙灵所隐”，因而得名。' },
  { id: 'xixi', name: '西溪湿地', city: '杭州', category: '自然风光', tags: ['湿地', '亲子', '观鸟'], price: 80, hours: '08:30–17:30（示例）', duration: 4, rating: 4.7, description: '适合观鸟与水上游览的湿地公园。', address: '杭州市西湖区天目山路518号', tip: '船票另计。', story: '西溪湿地保留了江南水乡的鱼塘、芦苇与村落肌理，端午龙舟是当地重要民俗。' },
  { id: 'hefang', name: '河坊街', city: '杭州', category: '城市漫游', tags: ['美食', '夜游', '免费', '文化'], price: 0, hours: '街区全天开放，商铺各异', duration: 2, rating: 4.6, description: '杭州传统商业街区。', address: '杭州市上城区河坊街', tip: '购物与餐饮另计。', story: '河坊街位于清河坊历史街区，胡庆余堂等老字号体现了杭州的商业与医药文化。' },
  { id: 'forbidden-city', name: '故宫博物院', city: '北京', category: '人文古迹', tags: ['博物馆', '建筑', '文化', '亲子'], price: 60, hours: '08:30–17:00（示例，通常周一闭馆）', duration: 4, rating: 4.9, description: '明清皇家宫殿与博物馆。', address: '北京市东城区景山前街4号', tip: '需官方实名预约；示例为旺季大门票，不含展馆。', story: '紫禁城始建于明代，是明清两代皇家宫殿，其中轴空间体现了中国传统礼制与木构建筑艺术。' },
  { id: 'summer-palace', name: '颐和园', city: '北京', category: '自然风光', tags: ['园林', '湖光山色', '文化'], price: 30, hours: '06:30–18:00（示例）', duration: 4, rating: 4.8, description: '以万寿山与昆明湖为主体的皇家园林。', address: '北京市海淀区新建宫门路19号', tip: '示例为旺季大门票，园中园另收费。', story: '颐和园融合了江南园林的意趣与皇家园林的气度，长廊彩画和十七孔桥是代表性景观。' },
  { id: 'panda', name: '大熊猫繁育研究基地', city: '成都', category: '自然风光', tags: ['熊猫', '亲子', '动物'], price: 55, hours: '07:30–18:00（示例）', duration: 3, rating: 4.9, description: '大熊猫保护、科研与公众教育基地。', address: '成都市成华区熊猫大道1375号', tip: '请勿敲玻璃、投喂。', story: '基地集保护、科研与公众教育于一体，可了解大熊猫栖息地保护及人工繁育知识。' },
  { id: 'kuanzhai', name: '宽窄巷子', city: '成都', category: '城市漫游', tags: ['美食', '文化', '免费', '夜游'], price: 0, hours: '街区全天开放，商铺各异', duration: 2, rating: 4.6, description: '成都历史院落与街巷。', address: '成都市青羊区长顺上街', tip: '餐饮消费另计。', story: '宽窄巷子由宽巷子、窄巷子、井巷子组成，展示了传统院落与现代城市生活。' },
  { id: 'bund', name: '外滩', city: '上海', category: '城市漫游', tags: ['建筑', '夜游', '免费', '散步'], price: 0, hours: '全天开放（公共区域）', duration: 2, rating: 4.8, description: '黄浦江畔的历史建筑街区。', address: '上海市黄浦区中山东一路', tip: '节假日请关注人流管控。', story: '外滩近代建筑群与浦东陆家嘴隔江相望，展现了上海城市历史与现代发展。' },
  { id: 'yuyuan', name: '豫园', city: '上海', category: '人文古迹', tags: ['园林', '建筑'], price: 40, hours: '09:00–16:30（示例）', duration: 2, rating: 4.7, description: '上海明代古典园林。', address: '上海市黄浦区福佑路168号', tip: '示例为旺季门票，开放安排请查阅官方公告。', story: '豫园始建于明代，假山、池水和亭台通过曲折游线营造出小中见大的空间体验。' },
];

export const cities = ['杭州', '北京', '成都', '上海', '深圳'];
