/// A shortcut stays blocked until the PTT key itself is released, even if the
/// modifier is released first. This prevents Ctrl+V from becoming a PTT press.
#[derive(Default)]
pub struct KeyState {
    held: bool,
    blocked: bool,
    active: bool,
}

impl KeyState {
    pub fn update(&mut self, held: bool, has_modifier: bool) -> Option<bool> {
        if !held {
            self.blocked = false;
        } else if has_modifier {
            self.blocked = true;
        }
        let active = held && !self.blocked && (self.active || !self.held);
        self.held = held;
        if active == self.active {
            return None;
        }
        self.active = active;
        Some(active)
    }
}

#[cfg(test)]
mod tests {
    use super::KeyState;

    #[test]
    fn regular_press_and_release() {
        let mut key = KeyState::default();
        assert_eq!(key.update(true, false), Some(true));
        assert_eq!(key.update(true, false), None);
        assert_eq!(key.update(false, false), Some(false));
        assert_eq!(key.update(false, false), None);
    }

    #[test]
    fn paste_ignores_both_release_orders() {
        for modifier_released_first in [false, true] {
            let mut key = KeyState::default();
            assert_eq!(key.update(true, true), None);
            if modifier_released_first {
                assert_eq!(key.update(true, false), None);
            }
            assert_eq!(key.update(false, !modifier_released_first), None);
            assert_eq!(key.update(false, false), None);
            assert_eq!(key.update(true, false), Some(true));
        }
    }

    #[test]
    fn adding_modifier_releases_ptt_until_next_press() {
        let mut key = KeyState::default();
        assert_eq!(key.update(true, false), Some(true));
        assert_eq!(key.update(true, true), Some(false));
        assert_eq!(key.update(true, false), None);
        assert_eq!(key.update(false, false), None);
        assert_eq!(key.update(true, false), Some(true));
    }
}
