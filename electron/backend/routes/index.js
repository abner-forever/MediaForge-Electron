const express = require('express');

const router = express.Router();

router.use(require('./settings'));
router.use(require('./discovery'));
router.use(require('./queue'));
router.use(require('./materials'));
router.use(require('./articles'));
router.use(require('./effects'));
router.use(require('./dashboard'));
router.use(require('./logs'));
router.use(require('./credits'));
router.use(require('./sync'));
router.use(require('./user'));
router.use(require('./wechat'));
router.use(require('./images'));
router.use(require('./pipeline'));

module.exports = router;
