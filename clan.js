import { world, Player, system } from "@minecraft/server";
import { ModalFormData, ActionFormData, MessageFormData } from "@minecraft/server-ui";

const clanPrefix = "clan:";
const forbiddenClans = ['owner', 'staff', 'admin', 'null', '0wner', 'own3r', 'niger', 'n-word', 'nword', 'hardr', 'nigger', 'nig', 'n1gg3r'];

const joinRequests = new Map();
const inviteRequests = new Map();
const attackCooldowns = new Map();

function getAllClans() {
    const clans = world.getDynamicProperty("clans");
    return clans ? JSON.parse(clans) : {};
}

function saveAllClans(clans) {
    world.setDynamicProperty("clans", JSON.stringify(clans));
}

function getTopClans() {
    const topClans = world.getDynamicProperty("topClans");
    return topClans ? JSON.parse(topClans) : [];
}

function saveTopClans(topClans) {
    world.setDynamicProperty("topClans", JSON.stringify(topClans));
}

function denyUI(player, nextUI, uiData) {
    player.playSound('error');
    nextUI(player, uiData);
}

function saveJoinRequests() {
    const requests = Array.from(joinRequests.entries());
    world.setDynamicProperty("clanJoinRequests", JSON.stringify(requests));
}

function loadJoinRequests() {
    const storedRequests = world.getDynamicProperty("clanJoinRequests");
    if (storedRequests) {
        const parsed = JSON.parse(storedRequests);
        joinRequests.clear();
        parsed.forEach(([key, value]) => joinRequests.set(key, value));
    }
}

function joinClan(player) {
    if (!(player instanceof Player)) return;

    if (player.getTags().some(tag => tag.startsWith('clan:'))) {
        player.sendMessage("§cYou are already in a clan. Leave your current clan first.");
        return;
    }

    const ui = new ActionFormData();
    ui.title('Join Clan');

    const clans = getAllClans();
    const clanList = Object.entries(clans).sort((a, b) => {
        // Sort by active status first, then member count
        if (a[1].active !== b[1].active) return b[1].active - a[1].active;
        return b[1].members.length - a[1].members.length;
    });

    if (clanList.length === 0) {
        ui.body('No clans available for joining.');
    } else {
        ui.body(`Available clans (${clanList.filter(c => c[1].active).length}/${clanList.length} active):\n`);
        clanList.forEach(([clanName, data]) => {
            const members = `${data.members.length}/25 members`;
            ui.button(`§a[JOIN] §r${clanName}\n§7${members} | Level ${data.level}`);
        });
    }
    ui.button('§cBack');

    ui.show(player).then(response => {
        if (response.canceled) return;
        if (response.selection >= clanList.length) {
            search(player);
            return;
        }

        const selectedClan = clanList[response.selection];
        if (selectedClan[1].members.length >= 25) {
            player.sendMessage("§cThis clan is full (25/25 members).");
            return;
        }

        player.addTag(`pending:${selectedClan[0]}`);
        joinRequests.set(player.name, {
            clan: selectedClan[0],
            status: 'pending',
            timestamp: Date.now()
        });
        saveJoinRequests();

        player.sendMessage(`§aRequest to join §b${selectedClan[0]}§a sent!`);

        const clanName = selectedClan[0];
        sendClanNotification(clanName, `${player.name} wants to join your clan! Use /clan manage to review`);
    });
}

function invitePlayer(player) {
    const ownerTag = player.getTags().find(tag => tag.startsWith('owner:'));
    if (!ownerTag) {
        player.sendMessage('§cYou are not authorized to invite players to this clan.');
        return;
    }

    const clanName = ownerTag.split(':')[1];
    const players = world.getDimension('overworld').getPlayers();
    const nonClanMembers = players.filter(p => !p.getTags().some(tag => tag.startsWith('clan:'))).map(p => p.name);

    if (nonClanMembers.length === 0) {
        player.sendMessage('§cNo players available to invite.');
        return;
    }

    const ui = new ModalFormData();
    ui.title("§aInvite Player").dropdown("§bSelect a player to invite", nonClanMembers);

    ui.show(player).then(response => {
        if (response.canceled) return;
        const selectedPlayerName = nonClanMembers[response.formValues[0]];
        const selectedPlayer = players.find(p => p.name === selectedPlayerName);

        if (selectedPlayer) {
            const confirmUI = new MessageFormData();
            confirmUI.title("§eConfirm Invitation");
            confirmUI.body(`§fAre you sure you want to invite §6${selectedPlayerName} §fto the clan "§6${clanName}"?`);
            confirmUI.button1('§cNO');
            confirmUI.button2('§aYES');

            confirmUI.show(player).then(confirmResponse => {
                if (confirmResponse.selection === 1) {
                    selectedPlayer.addTag(`member:${clanName}`);
                    selectedPlayer.addTag(`clan:${clanName}`);
                    selectedPlayer.sendMessage(`§aYou have been invited and added to the clan "${clanName}" by ${player.name}.`);
                    player.sendMessage(`§aYou have invited and added ${selectedPlayerName} to the clan "${clanName}".`);
                    player.runCommandAsync('playsound firework.launch @s');

                    const clans = getAllClans();
                    const clanData = clans[clanName];
                    if (clanData) {
                        clanData.members.push(selectedPlayerName);
                        clans[clanName] = clanData;
                    }
                    saveAllClans(clans);
                } else {
                    player.sendMessage('§cInvitation canceled.');
                }
            });
        } else {
            player.sendMessage('§cCould not find the selected player.');
        }
    });
}

function calculateClanLevel(memberCount) {
    return Math.floor(memberCount / 5) + 1;
}

function validateClanName(name) {
    return (
        name.length >= 3 &&
        name.length <= 12 &&
        !/[^A-Za-z0-9§]/.test(name) &&
        !forbiddenClans.some(forbidden => name.toLowerCase().includes(forbidden)) &&
        !getAllClans()[name]
    );
}

function createClan(player) {
    if (!(player instanceof Player)) return;

    if (player.getTags().some(tag => tag.startsWith('clan:'))) {
        player.sendMessage("§cYou are already in a clan. You must leave your current clan before creating a new one.");
        return;
    }

    const ui = new ModalFormData();
    ui.title("Create Clan").textField("Enter clan name", "");

    ui.show(player).then(response => {
        if (response.canceled) return;
        const clanName = response.formValues[0];

        if (!validateClanName(clanName)) {
            player.sendMessage("§cInvalid clan name! Must be 3-12 characters, no spaces, and not contain forbidden words");
            denyUI(player, createClan, 'Invalid Clan Name');
            return;
        }

        const clanTag = `[${clanName.substring(0, 3).toUpperCase()}]`;
        player.addTag(`owner:${clanName}`);
        player.addTag(`clan:${clanName}`);
        player.sendMessage(`§aSuccessfully created clan "${clanName}" with tag ${clanTag}`);

        const clans = getAllClans();
        clans[clanName] = {
            owner: player.name,
            members: [player.name],
            active: true,
            tag: clanTag,
            level: 1,
            created: Date.now()
        };
        saveAllClans(clans);

    });
}

function manageClan(player) {
    if (!(player instanceof Player)) return;

    const ownerTag = player.getTags().find(tag => tag.startsWith('owner:'));
    if (ownerTag) {
        const clanName = ownerTag.split(':')[1];
        const ui = new ActionFormData();
        ui.title("Manage Clan");
        ui.body("Ensure that players wanting to join are in the world for approval.");
        ui.button("Edit Clan Name");
        ui.button("Kick Member");
        ui.button("Approve/Deny New Members");
        ui.button("Invite Player");
        ui.button("Toggle PvP Protection");
        ui.button("Delete Clan");

        ui.show(player).then(response => {
            if (response.canceled) return;
            switch (response.selection) {
                case 0:
                    editClanName(player);
                    break;
                case 1:
                    kickMember(player);
                    break;
                case 2:
                    approveDenyMembers(player);
                    break;
                case 3:
                    invitePlayer(player);
                    break;
                case 4:
                    toggleClanPvP(player);
                    break;
                case 5:
                    deleteClan(player);
                    break;
            }
        });
    } else {
        player.sendMessage("§cYou are not authorized to manage this clan.");
    }
}

function approveDenyMembers(player) {
    const ownerTag = player.getTags().find(tag => tag.startsWith('owner:'));
    if (!ownerTag) {
        player.sendMessage('§cYou are not authorized to manage this clan.');
        return;
    }

    const clanName = ownerTag.split(':')[1];
    const pendingMembers = Array.from(joinRequests.entries())
        .filter(([name, data]) => data.clan === clanName && data.status === 'pending')
        .map(([name, _]) => name);

    if (pendingMembers.length === 0) {
        player.sendMessage('§cNo pending members to approve or deny.');
        return;
    }

    const ui = new ModalFormData();
    ui.title("Pending Join Requests");
    ui.dropdown("Select request to review", pendingMembers);
    ui.toggle("Approve this request", true);

    ui.show(player).then(response => {
        if (response.canceled) return;
        const selectedMemberName = pendingMembers[response.formValues[0]];
        const approve = response.formValues[1];

        if (joinRequests.has(selectedMemberName)) {
            const requestData = joinRequests.get(selectedMemberName);
            const playerToTag = world.getPlayers().find(p => p.name === selectedMemberName);
            if (approve) {
                requestData.status = 'approved';
                if (playerToTag) {
                    playerToTag.removeTag(`pending:${clanName}`);
                    playerToTag.addTag(`member:${clanName}`);
                    playerToTag.addTag(`clan:${clanName}`);
                    playerToTag.sendMessage(`§eCongratulations!§r You have been approved and added to the clan "${clanName}".`);
                    playerToTag.playSound('random.levelup');
                }
                const clans = getAllClans();
                clans[clanName].active = true;
                clans[clanName] = clans[clanName];
                saveAllClans(clans);
            } else {
                requestData.status = 'denied';
                if (playerToTag) {
                    playerToTag.removeTag(`pending:${clanName}`);
                    playerToTag.sendMessage(`You have been denied entry to the clan "${clanName}". Better luck next time.`);
                }
            }
            joinRequests.delete(selectedMemberName);
            saveJoinRequests();
        } else {
            player.sendMessage('§cCould not find the selected member.');
        }
    });
}

function editClanName(player) {
    const ownerTag = player.getTags().find(tag => tag.startsWith('owner:'));
    if (!ownerTag) {
        player.sendMessage('§cYou are not authorized to manage this clan.');
        return;
    }

    const oldClanName = ownerTag.split(':')[1];

    const ui = new ModalFormData();
    ui.title("Edit Clan Name").textField("New clan name", "Enter new name here");

    ui.show(player).then(response => {
        if (response.canceled) return;
        const newClanName = response.formValues[0];

        if (!validateClanName(newClanName)) {
            player.sendMessage("§cNew clan name is invalid!");
            denyUI(player, editClanName, 'Invalid Clan Name');
            return;
        }

        const clans = getAllClans();
        const clanData = clans[oldClanName];
        clanData.tag = `[${newClanName.substring(0, 3).toUpperCase()}]`;
        clans[newClanName] = clanData;
        delete clans[oldClanName];

        const players = world.getDimension('overworld').getPlayers();
        players.forEach(p => {
            if (p.getTags().includes(`clan:${oldClanName}`)) {
                p.removeTag(`clan:${oldClanName}`);
                p.addTag(`clan:${newClanName}`);
            }
        });

        player.removeTag(`owner:${oldClanName}`);
        player.addTag(`owner:${newClanName}`);
        player.addTag(`clan:${newClanName}`);
        player.sendMessage(`§aClan name successfully changed to "${newClanName}"`);

        clanData.members.forEach(memberName => {
            const member = world.getPlayer(memberName);
            if (member) {
                member.getTags().filter(tag => tag.startsWith('clan:')).forEach(tag => member.removeTag(tag));
                member.addTag(`clan:${newClanName}`);
            }
        });

        saveAllClans(clans);
    });
}

function kickMember(player) {
    const ownerTag = player.getTags().find(tag => tag.startsWith('owner:'));
    if (!ownerTag) {
        player.sendMessage('§cYou are not authorized to manage this clan.');
        return;
    }

    const clanName = ownerTag.split(':')[1];
    const players = world.getDimension('overworld').getPlayers();
    const clanMembers = players.filter(p => p.getTags().includes(`clan:${clanName}`) && !p.getTags().includes(`owner:${clanName}`)).map(p => p.name);

    if (clanMembers.length === 0) {
        player.sendMessage('§cNo members in your clan to kick.');
        return;
    }

    const ui = new ModalFormData();
    ui.title("Kick Member").dropdown("Select a member to kick", clanMembers);

    ui.show(player).then(response => {
        if (response.canceled) return;
        const selectedMemberName = clanMembers[response.formValues[0]];
        const selectedMember = players.find(p => p.name === selectedMemberName);

        if (selectedMember) {
            selectedMember.removeTag(`clan:${clanName}`);
            selectedMember.sendMessage(`You have been kicked from the clan "${clanName}" by ${player.name}.`);
            selectedMember.playSound('random.orb');
            player.sendMessage(`You have kicked ${selectedMemberName} from the clan "${clanName}".`);

            const clans = getAllClans();
            const clanData = clans[clanName];
            if (clanData) {
                clanData.members = clanData.members.filter(member => member !== selectedMemberName);
                clans[clanName] = clanData;
            }
            saveAllClans(clans);
        } else {
            player.sendMessage('§cCould not find the selected member.');
        }
    });
}

function leaveClan(player) {
    const clanTag = player.getTags().find(tag => tag.startsWith('clan:'));
    if (!clanTag) {
        player.sendMessage("§cYou are not currently in any clan.");
        return;
    }

    const clanName = clanTag.split(':')[1];
    const ui = new ActionFormData();
    ui.title("Confirmation to Leave Clan");
    ui.body(`Are you sure you want to leave the clan "${clanName}"?`);
    ui.button("Yes");
    ui.button("No");

    ui.show(player).then(response => {
        if (response.canceled || response.selection === 1) return;

        player.getTags().filter(tag => tag.startsWith('clan:') || tag.startsWith('owner:') || tag.startsWith('member:')).forEach(tag => {
            player.removeTag(tag);
        });

        player.sendMessage(`You have left the clan "${clanName}".`);
        const clans = getAllClans();
        if (clans[clanName] && clans[clanName].owner === player.name) {
            const clanData = clans[clanName];
            const players = world.getDimension('overworld').getPlayers();
            const clanMembers = players.filter(p => p.getTags().includes(`clan:${clanName}`) && !p.getTags().includes(`owner:${clanName}`));

            if (clanMembers.length > 0) {
                const newOwner = clanMembers[Math.floor(Math.random() * clanMembers.length)];
                newOwner.addTag(`owner:${clanName}`);
                clanData.owner = newOwner.name;
                clans[clanName] = clanData;
                newOwner.sendMessage(`You have been promoted to the owner of the clan "${clanName}".`);
            } else {
                delete clans[clanName];
            }
        } else {
            const clanData = clans[clanName];
            if (clanData) {
                clanData.members = clanData.members.filter(member => member !== player.name);
                clans[clanName] = clanData;
            }
        }
        saveAllClans(clans);
    });
}

function clanChat(player, message) {
    const clanTag = player.getTags().find(tag => tag.startsWith('clan:'));
    if (!clanTag) {
        player.sendMessage("§cYou are not in any clan.");
        return;
    }

    const clanName = clanTag.split(':')[1];
    const players = world.getDimension('overworld').getPlayers();
    const clanMembers = players.filter(p => p.getTags().includes(clanTag));

    clanMembers.forEach(member => {
        member.playSound('random.orb');
        member.sendMessage(`§b[Clan ${clanName}] §f${player.name}: §a${message}`);
    });
}

function search(player) {
    const ui = new ActionFormData();
    ui.title("§6§lClan Menu");

    const hasClanTag = player.getTags().some(tag => tag.startsWith('clan:'));

    if (hasClanTag) {
        ui.button('Clan Information', 'textures/ui/bookshelf_flat');
        ui.button('Clan Chat', 'textures/ui/comment');
        ui.button('Manage Clan', 'textures/ui/op');
        ui.button('Top Clan', 'textures/ui/icon_new_item');
        ui.button('Leave Clan', 'textures/ui/redX1');
    } else {
        ui.button('Join Clan', 'textures/ui/csb_purchase_warning');
        ui.button('Create Clan', 'textures/ui/color_plus');
        ui.button('Top Clan', 'textures/ui/icon_new_item');
    }

    ui.show(player).then(response => {
        if (response.canceled) return;
        switch (response.selection) {
            case 0:
                if (hasClanTag) {
                    clanInformation(player);
                } else {
                    joinClan(player);
                }
                break;
            case 1:
                if (hasClanTag) {
                    promptClanChat(player);
                } else {
                    createClan(player);
                }
                break;
            case 2:
                if (hasClanTag) {
                    manageClan(player);
                } else {
                    topClan(player);
                }
                break;
            case 3:
                if (hasClanTag) {
                    topClan(player);
                }
                break;
            case 4:
                if (hasClanTag) {
                    leaveClan(player);
                }
                break;
        }
    });
}

function promptClanChat(player) {
    const ui = new ModalFormData();
    ui.title("Clan Chat").textField("Enter your message", "Type your message here");

    ui.show(player).then(response => {
        if (response.canceled) return;
        const message = response.formValues[0];
        clanChat(player, message);
    });
}

function deleteClan(player) {
    const ownerTag = player.getTags().find(tag => tag.startsWith('owner:'));
    if (!ownerTag) {
        player.sendMessage('§cYou are not authorized to delete this clan.');
        return;
    }

    const clanName = ownerTag.split(':')[1];

    const ui = new MessageFormData();
    ui.title("Clan Deletion Confirmation");
    ui.body(`Are you sure you want to delete the clan "${clanName}"? This action cannot be undone.`);
    ui.button1('NO');
    ui.button2('YES');

    ui.show(player).then(response => {
        if (response.selection === 1) {
            const players = world.getDimension('overworld').getPlayers();

            players.forEach(p => {
                if (p.getTags().includes(`clan:${clanName}`) || p.getTags().includes(`owner:${clanName}`)) {
                    p.removeTag(`clan:${clanName}`);
                    p.removeTag(`member:${clanName}`);
                    p.removeTag(`owner:${clanName}`);
                    p.sendMessage(`The clan "${clanName}" has been disbanded.`);
                }
            });

            const clans = getAllClans();
            const clanData = clans[clanName];
            if (clanData) {
                clanData.members.forEach(member => {
                    const memberPlayer = world.getPlayer(member);
                    if (memberPlayer) {
                        memberPlayer.removeTag(`clan:${clanName}`);
                        memberPlayer.removeTag(`member:${clanName}`);
                    }
                });
            }

            player.sendMessage(`You have disbanded the clan "${clanName}".`);
            delete clans[clanName];
            saveAllClans(clans);
        } else {
            player.sendMessage('Clan deletion canceled.');
        }
    });
}

function clanInformation(player) {
    const clanTag = player.getTags().find(tag => tag.startsWith('clan:'));
    if (!clanTag) {
        player.sendMessage('§cYou are not in any clan');
        return;
    }

    const clanName = clanTag.split(':')[1];
    const clans = getAllClans();
    const clanData = clans[clanName];

    const memberCount = clanData.members.length;
    const level = calculateClanLevel(memberCount);
    const onlineMembers = world.getPlayers().filter(p => p.getTags().includes(clanTag)).map(p => p.name);

    const ui = new MessageFormData();
    ui.title(`§6[${clanData.tag}] §b${clanName}`);
    ui.body(`Level: §a${level}\nOwner: §e${clanData.owner}\nMembers: §a${memberCount}\nOnline: §e${onlineMembers.length}\n\nMember List:\n${clanData.members.join('\n')}`);
    ui.button1('Close');
    ui.button2('Refresh Info');

    ui.show(player).then(response => {
        if (response.selection === 1) clanInformation(player);
    });
}

function topClan(player) {
    const clans = getAllClans();
    const sortedClans = Object.entries(clans)
        .sort((a, b) => {
            const aScore = b[1].members.length + (b[1].level * 10);
            const bScore = a[1].members.length + (a[1].level * 10);
            return aScore - bScore;
        })
        .slice(0, 10);

    const topList = sortedClans.map(([name, data], index) =>
        `§6${index + 1}. §b[${data.tag}] ${name}\n   Level: §a${data.level} §f| Members: §e${data.members.length}`
    ).join('\n\n');

    const ui = new MessageFormData();
    ui.title('§6Top 10 Clans');
    ui.body(topList || 'No clans registered yet');
    ui.button1('Close');
    ui.button2('Refresh');

    ui.show(player).then(response => {
        if (response.selection === 1) topClan(player);
    });
}

function sendClanNotification(clanName, message) {
    const clans = getAllClans();
    const clanData = clans[clanName];

    clanData.members.forEach(memberName => {
        const member = world.getPlayer(memberName);
        if (member) {
            member.sendMessage(`§8[§6CLAN§8] §r${message}`);
            member.playSound('note.pling');
        }
    });
}

function Clan(player) {
    search(player);
}

function getClanProtection() {
    const protection = world.getDynamicProperty("clanProtection");
    return protection ? JSON.parse(protection) : {};
}

function saveClanProtection(protection) {
    world.setDynamicProperty("clanProtection", JSON.stringify(protection));
}

function toggleClanPvP(player) {
    const ownerTag = player.getTags().find(tag => tag.startsWith('owner:'));
    if (!ownerTag) return;

    const clanName = ownerTag.split(':')[1];
    const protection = getClanProtection();
    const currentStatus = protection[clanName] || false;

    protection[clanName] = !currentStatus;
    saveClanProtection(protection);

    const statusText = protection[clanName] ? "§aENABLED" : "§cDISABLED";
    player.sendMessage(`Clan PvP protection is now ${statusText}§r for ${clanName}`);
    sendClanNotification(clanName, `PvP protection has been ${currentStatus ? 'disabled' : 'enabled'}`);
}

function playProtectionEffect(entity) {
    if (!entity) return;
    try {
        entity.runCommand("effect @s weakness 10 255 true");
    } catch (error) {
        console.error("Error in playProtectionEffect:", error);
    }
}

function cleanupCooldowns() {
    const now = Date.now();
    attackCooldowns.forEach((expireTime, playerName) => {
        if (now > expireTime) {
            attackCooldowns.delete(playerName);
        }
    });

    // Jadwalkan cleanup berikutnya setelah 20 tick (1 detik)
    system.runTimeout(cleanupCooldowns, 20);
}

// Mulai cleanup dengan delay 20 tick
system.runTimeout(cleanupCooldowns, 20);

world.afterEvents.entityHurt.subscribe(event => {
    const { damageSource, hurtEntity } = event;
    const attacker = damageSource.damagingEntity;

    if (attacker instanceof Player && hurtEntity instanceof Player) {
        // Ambil tag clan dari penyerang dan korban
        const attackerClanTag = attacker.getTags().find(tag => tag.startsWith('clan:'));
        const victimClanTag = hurtEntity.getTags().find(tag => tag.startsWith('clan:'));

        // Cek cooldown terlebih dahulu
        if (attackCooldowns.has(attacker.name)) {
            event.cancel = true;
            attacker.sendMessage("§cYou're attacking too fast! Wait 2 seconds");
            playProtectionEffect(attacker);
            return;
        }

        // Hanya blok serangan jika kedua pemain berada di clan yang sama
        if (attackerClanTag && victimClanTag) {
            const attackerClan = attackerClanTag.split(':')[1];
            const victimClan = victimClanTag.split(':')[1];

            if (attackerClan === victimClan) {
                event.cancel = true;
                attacker.sendMessage("§cYou can't attack your own clan members!");
                attackCooldowns.set(attacker.name, Date.now() + 2000);
                playProtectionEffect(attacker);
                return;
            }
        }
    }
});

world.afterEvents.playerSpawn.subscribe(event => {
    const player = event.player;
    const ownerTag = player.getTags().find(tag => tag.startsWith('owner:'));

    if (ownerTag) {
        const clanName = ownerTag.split(':')[1];
        const pendingCount = Array.from(joinRequests.values()).filter(r => r.clan === clanName && r.status === 'pending').length;

        if (pendingCount > 0) {
            player.sendMessage(`§e[CLAN] You have ${pendingCount} pending join request(s)! Open manage clan to review`);
            player.playSound('note.pling');
        }
    }
});

export { Clan, leaveClan };