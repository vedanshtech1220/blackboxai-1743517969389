const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Get user balance
router.get('/balance', requireAuth, (req, res) => {
  db.get(
    'SELECT balance FROM users WHERE id = ?',
    [req.session.userId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ balance: row.balance });
    }
  );
});

// Get transaction history
router.get('/history', requireAuth, (req, res) => {
  db.all(
    `SELECT id, type, amount, description, timestamp 
     FROM transactions 
     WHERE user_id = ? 
     ORDER BY timestamp DESC
     LIMIT 10`,
    [req.session.userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows);
    }
  );
});

// Create new transaction
router.post('/', requireAuth, (req, res) => {
  const { type, amount, description } = req.body;

  // Validate input
  if (!type || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid transaction data' });
  }

  // Process transaction
  db.serialize(() => {
    // First check balance for withdrawals
    if (type === 'withdraw') {
      db.get(
        'SELECT balance FROM users WHERE id = ?',
        [req.session.userId],
        (err, user) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          if (user.balance < amount) {
            return res.status(400).json({ error: 'Insufficient funds' });
          }
          processTransaction();
        }
      );
    } else {
      processTransaction();
    }

    function processTransaction() {
      // Update user balance
      const balanceUpdate = type === 'deposit' ? amount : -amount;
      db.run(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [balanceUpdate, req.session.userId],
        function(err) {
          if (err) return res.status(500).json({ error: 'Database error' });

          // Record transaction
          db.run(
            `INSERT INTO transactions 
             (user_id, type, amount, description) 
             VALUES (?, ?, ?, ?)`,
            [req.session.userId, type, amount, description],
            function(err) {
              if (err) return res.status(500).json({ error: 'Database error' });
              
              // Get updated balance
              db.get(
                'SELECT balance FROM users WHERE id = ?',
                [req.session.userId],
                (err, user) => {
                  if (err) return res.status(500).json({ error: 'Database error' });
                  res.json({ 
                    message: 'Transaction completed',
                    newBalance: user.balance
                  });
                }
              );
            }
          );
        }
      );
    }
  });
});

router.post('/transfer', requireAuth, async (req, res) => {
  const { email, amount, description } = req.body;
  const senderId = req.session.userId;

  if (!email || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid transfer data' });
  }

  try {
    // Find recipient
    const recipient = await new Promise((resolve, reject) => {
      db.get('SELECT id, name FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });
    if (!recipient) throw new Error('Recipient not found');
    if (recipient.id === senderId) throw new Error('Cannot transfer to yourself');

    // Check sender's balance
    const sender = await new Promise((resolve, reject) => {
      db.get('SELECT balance FROM users WHERE id = ?', [senderId], (err, row) => {
        if (err) reject(err);
        resolve(row.balance);
      });
    });
    if (sender < amount) throw new Error('Insufficient funds');

    // Begin transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // Deduct from sender
      db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, senderId]);

      // Add to recipient
      db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, recipient.id]);

      // Record transfer
      db.run(
        'INSERT INTO transactions (user_id, type, amount, description, recipient_id) VALUES (?, ?, ?, ?, ?)',
        [senderId, 'transfer', amount, description, recipient.id],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Database error' });
          }

          // Commit
          db.run('COMMIT');
          res.json({ 
            message: 'Transfer completed', 
            newBalance: sender - amount,
            recipientName: recipient.name
          });
        }
      );
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
