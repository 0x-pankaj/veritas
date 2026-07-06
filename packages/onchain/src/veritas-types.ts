/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/veritas.json`.
 */
export type Veritas = {
  "address": "CiGK2btZHdeW1U327ZLDhTQhDhP9TB6U16oG4a21YTUG",
  "metadata": {
    "name": "veritas",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Veritas — consensus verification, seller registry, and reputation for the agent economy"
  },
  "instructions": [
    {
      "name": "addStake",
      "discriminator": [
        58,
        135,
        189,
        105,
        160,
        120,
        165,
        224
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "seller",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  108,
                  108,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "stakeMint"
        },
        {
          "name": "ownerToken",
          "docs": [
            "Seller's own token account to stake from."
          ],
          "writable": true
        },
        {
          "name": "custody",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeRequest",
      "discriminator": [
        170,
        46,
        165,
        120,
        223,
        102,
        115,
        2
      ],
      "accounts": [
        {
          "name": "coordinator",
          "docs": [
            "Rent is reclaimed to the coordinator (it paid to open the request)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  114,
                  101,
                  113
                ]
              },
              {
                "kind": "arg",
                "path": "queryId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "queryId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "finalizeConsensus",
      "discriminator": [
        158,
        21,
        141,
        117,
        251,
        129,
        243,
        22
      ],
      "accounts": [
        {
          "name": "coordinator",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  114,
                  101,
                  113
                ]
              },
              {
                "kind": "arg",
                "path": "queryId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "queryId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "coordinator",
          "type": "pubkey"
        },
        {
          "name": "stakeMint",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "toleranceBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "openRequest",
      "discriminator": [
        82,
        209,
        193,
        32,
        229,
        80,
        228,
        197
      ],
      "accounts": [
        {
          "name": "coordinator",
          "docs": [
            "Only the coordinator authority may open requests."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  114,
                  101,
                  113
                ]
              },
              {
                "kind": "arg",
                "path": "queryId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "queryId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "buyerRef",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "mode",
          "type": {
            "defined": {
              "name": "consensusMode"
            }
          }
        },
        {
          "name": "k",
          "type": "u8"
        }
      ]
    },
    {
      "name": "registerSeller",
      "discriminator": [
        9,
        50,
        144,
        162,
        206,
        176,
        154,
        111
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "The seller registering itself — pays rent and owns the account."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "seller",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  108,
                  108,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "submitResponse",
      "discriminator": [
        85,
        190,
        208,
        119,
        243,
        52,
        133,
        90
      ],
      "accounts": [
        {
          "name": "coordinator",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  114,
                  101,
                  113
                ]
              },
              {
                "kind": "arg",
                "path": "queryId"
              }
            ]
          }
        },
        {
          "name": "seller",
          "docs": [
            "The responding seller must be registered; existence is the check."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  108,
                  108,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "sellerOwner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "queryId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "sellerOwner",
          "type": "pubkey"
        },
        {
          "name": "value",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "withdrawStake",
      "discriminator": [
        153,
        8,
        22,
        138,
        105,
        176,
        87,
        66
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "seller",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  108,
                  108,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "custody",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "sellerAccount",
      "discriminator": [
        165,
        133,
        123,
        22,
        51,
        242,
        209,
        52
      ]
    },
    {
      "name": "verificationRequest",
      "discriminator": [
        66,
        147,
        154,
        149,
        184,
        5,
        129,
        4
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Signer is not the coordinator authority"
    },
    {
      "code": 6001,
      "name": "invalidK",
      "msg": "k must be between MIN_RESPONSES and MAX_K"
    },
    {
      "code": 6002,
      "name": "requestNotOpen",
      "msg": "Request is not open"
    },
    {
      "code": 6003,
      "name": "requestNotClosed",
      "msg": "Request is not settled or failed"
    },
    {
      "code": 6004,
      "name": "duplicateSeller",
      "msg": "Seller already submitted a response for this request"
    },
    {
      "code": 6005,
      "name": "tooManyResponses",
      "msg": "Request already has k responses"
    },
    {
      "code": 6006,
      "name": "valueTooLarge",
      "msg": "Response value exceeds MAX_RESPONSE_BYTES"
    },
    {
      "code": 6007,
      "name": "valueTooSmallForNumeric",
      "msg": "Numeric response must be at least 8 bytes (i64 LE)"
    },
    {
      "code": 6008,
      "name": "notEnoughResponses",
      "msg": "Fewer responses than MIN_RESPONSES; cannot finalize"
    },
    {
      "code": 6009,
      "name": "sellerMismatch",
      "msg": "Seller account does not match the response entry"
    },
    {
      "code": 6010,
      "name": "badRemainingAccounts",
      "msg": "remaining_accounts must contain each responding seller, in order"
    },
    {
      "code": 6011,
      "name": "nameTooLong",
      "msg": "Name exceeds MAX_NAME_LEN"
    },
    {
      "code": 6012,
      "name": "wrongStakeMint",
      "msg": "Token account mint does not match config.stake_mint"
    },
    {
      "code": 6013,
      "name": "wrongTokenOwner",
      "msg": "Token account is not owned by the signer"
    },
    {
      "code": 6014,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6015,
      "name": "insufficientStake",
      "msg": "Withdrawal exceeds ledger stake"
    },
    {
      "code": 6016,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "config",
      "docs": [
        "Global config singleton. Seeds: [\"config\"]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "coordinator",
            "docs": [
              "Only this key may open/submit/finalize/close verification requests."
            ],
            "type": "pubkey"
          },
          {
            "name": "stakeMint",
            "docs": [
              "Mint sellers stake with (USDC). Custody token accounts use this mint."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "docs": [
              "Veritas fee in basis points (informational on-chain; enforced off-chain)."
            ],
            "type": "u16"
          },
          {
            "name": "toleranceBps",
            "docs": [
              "Numeric consensus tolerance in basis points relative to the median."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "consensusMode",
      "docs": [
        "How responses are compared in `finalize_consensus`."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "numeric"
          },
          {
            "name": "hash"
          }
        ]
      }
    },
    {
      "name": "requestStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "settled"
          },
          {
            "name": "failed"
          }
        ]
      }
    },
    {
      "name": "responseEntry",
      "docs": [
        "One seller's committed response inside a request."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "len",
            "type": "u8"
          },
          {
            "name": "value",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "sellerAccount",
      "docs": [
        "One registered data seller. Seeds: [\"seller\", owner]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "reputation",
            "docs": [
              "0..=1000, starts at REPUTATION_START."
            ],
            "type": "u32"
          },
          {
            "name": "served",
            "type": "u32"
          },
          {
            "name": "matched",
            "type": "u32"
          },
          {
            "name": "outliers",
            "type": "u32"
          },
          {
            "name": "stake",
            "docs": [
              "USDC stake in custody (base units). Custody transfer lands in P1-T2b."
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "sellerStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "sellerStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "suspended"
          }
        ]
      }
    },
    {
      "name": "verificationRequest",
      "docs": [
        "One consensus purchase round. Seeds: [\"vreq\", query_id]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "queryId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "buyerRef",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "consensusMode"
              }
            }
          },
          {
            "name": "k",
            "type": "u8"
          },
          {
            "name": "responses",
            "type": {
              "vec": {
                "defined": {
                  "name": "responseEntry"
                }
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "requestStatus"
              }
            }
          },
          {
            "name": "verdictLen",
            "docs": [
              "Consensus truth (numeric i64 LE, or the majority hash). Empty until settled."
            ],
            "type": "u8"
          },
          {
            "name": "verdict",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "winnersBitmap",
            "docs": [
              "Bit i set = responses[i].seller matched consensus."
            ],
            "type": "u8"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
